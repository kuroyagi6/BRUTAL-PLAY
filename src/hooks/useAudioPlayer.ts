import React from 'react';
import { usePersistentState } from './usePersistentState';
import type { Track } from '../types';
import { pickAdjacent, isLastInQueue, reconcileCurrentId, resolveQueue } from '../audio/queue';
import { createAudioGraph, makeDistortionCurve, applyNormalization } from '../audio/audioGraph';
import { resolvePlayableSource, isNativeTrack } from '../audio/playbackSource';
import type { PlayableSource } from '../audio/playbackSource';
import { useMediaLibrary } from '../library/useMediaLibrary';
import { useSpatialFx } from './useSpatialFx';
import { nextNode, prevNode, type NodeRef } from '../audio/wires';
import { tracksUnderOrdered } from '../library/folderTree';
import { pinTrackIds } from '../library/pinnedNodes';

// Track is defined in ../types now; re-export so existing type-only imports of
// `Track` from this hook keep working without churn.
export type { Track } from '../types';

export const useAudioPlayer = () => {
  // The library (tracks, playlists, disk usage, import, dedupe) lives in its own
  // hook. This hook is the playback engine; it composes the library and tracks
  // which track is current by id.
  const library = useMediaLibrary();
  const { playlist, userPlaylists, diskUsage, wires, unlinkedFolders } = library;

  // Reverb / delay / stereo width. Owns its own state and nodes; this hook only
  // hands it an insert point once the core graph exists (see initAudioContext).
  const spatialFx = useSpatialFx();

  const [currentTrackId, setCurrentTrackId] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null);
  const [eq, setEq] = usePersistentState('brutal-eq', { bass: 0, mid: 0, treble: 0 });
  const [distortion, setDistortion] = usePersistentState('brutal-distortion', 0);
  const [volume, setVolume] = usePersistentState('brutal-volume', 1);
  const [isMuted, setIsMuted] = usePersistentState('brutal-isMuted', false);
  const [shuffle, setShuffle] = usePersistentState('brutal-shuffle', false);
  const [playbackRate, setPlaybackRate] = usePersistentState('brutal-playbackRate', 1);
  const [crossfade, setCrossfade] = usePersistentState('brutal-crossfade', 0);
  const [normalizeVolume, setNormalizeVolume] = usePersistentState('brutal-normalizeVolume', false);
  // Experimental: stream native files over local-media:// instead of reading
  // them fully into memory. Off until seeking is verified — see playbackSource.ts.
  const [streamPlayback, setStreamPlayback] = usePersistentState('brutal-streamPlayback', false);
  const [sleepDeadline, setSleepDeadline] = React.useState<number | null>(null);
  const [repeatMode, setRepeatMode] = usePersistentState<'none' | 'one' | 'all'>('brutal-repeatMode', 'none');
  
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const sourceRef = React.useRef<MediaElementAudioSourceNode | null>(null);
  const bassFilterRef = React.useRef<BiquadFilterNode | null>(null);
  const midFilterRef = React.useRef<BiquadFilterNode | null>(null);
  const trebleFilterRef = React.useRef<BiquadFilterNode | null>(null);
  const distortionNodeRef = React.useRef<WaveShaperNode | null>(null);
  const compressorRef = React.useRef<DynamicsCompressorNode | null>(null);
  const normGainRef = React.useRef<GainNode | null>(null);
  const fadeGainRef = React.useRef<GainNode | null>(null);

  // Crossfade state (refs so event handlers always see current values)
  const crossfadeRef = React.useRef(crossfade);
  const crossfadeTriggeredRef = React.useRef(false);
  const fadeInPendingRef = React.useRef(false);
  const tailRef = React.useRef<HTMLAudioElement | null>(null);
  const tailIntervalRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    crossfadeRef.current = crossfade;
  }, [crossfade]);

  // Current selection is tracked by id; the index is derived from the live
  // playlist so removing/reordering tracks can never mis-point the current one.
  const currentIndex = currentTrackId ? playlist.findIndex((t) => t.id === currentTrackId) : -1;
  const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null;
  const currentTrackRef = React.useRef<Track | null>(null);
  const isPlayingRef = React.useRef(false);
  // Mirrors of state so the stable next/prev callbacks always read fresh values.
  const playlistRef = React.useRef<Track[]>([]);
  const shuffleRef = React.useRef(false);
  // The active play queue: an ordered list of track IDs. next/prev walk THIS,
  // so playback follows the list the user is looking at (sorted / album / genre),
  // not the hidden master array order. Empty = fall back to master order.
  // queueRef is the synchronous source of truth for the stable transport
  // callbacks; `queue` state mirrors it so the UI (Queue window) can render it.
  const queueRef = React.useRef<string[]>([]);
  const [queue, setQueue] = React.useState<string[]>([]);

  // Which desktop object the current queue came from (folder/playlist/video), or
  // null when playback started from the library/spotlight (unwired). Wires only
  // fire when this is set. See src/audio/wires.ts.
  const activeSourceRef = React.useRef<NodeRef | null>(null);
  // Mirrors so the stable transport callbacks read the live graph/playlists.
  const wiresRef = React.useRef(wires);
  const userPlaylistsRef = React.useRef(userPlaylists);
  // App registers this so a wire INTO a video root can hand off to the video
  // layer (which lives outside the audio engine). Returns true if it took over.
  const videoWireHandlerRef = React.useRef<((node: NodeRef) => boolean) | null>(null);
  // Same idea for the YouTube layer: a wire INTO a youtube node hands off to the
  // embedded-player window (also outside the audio engine).
  const youtubeWireHandlerRef = React.useRef<((node: NodeRef) => boolean) | null>(null);

  React.useEffect(() => {
    wiresRef.current = wires;
  }, [wires]);

  // Link switches as a Set (lowercased), mirrored for the stable callbacks.
  const unlinkedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    unlinkedRef.current = new Set(unlinkedFolders);
  }, [unlinkedFolders]);

  React.useEffect(() => {
    userPlaylistsRef.current = userPlaylists;
  }, [userPlaylists]);

  React.useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  React.useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  React.useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  React.useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  // Keep the current selection valid as the library changes (imports, removals,
  // dedupe). Tracking by id means we never point at the wrong track.
  React.useEffect(() => {
    const nextId = reconcileCurrentId(playlist.map((t) => t.id), currentTrackId);
    if (nextId !== currentTrackId) {
      setCurrentTrackId(nextId);
      if (nextId === null) setIsPlaying(false);
    }
  }, [playlist, currentTrackId]);

  // ── Playback source lifecycle ──
  // Blob URL currently assigned to the <audio> element (revoked on change).
  const objectUrlRef = React.useRef<string | null>(null);
  // Identity of the track whose source is loaded, so play/pause never reloads.
  const loadedTrackIdRef = React.useRef<string | null>(null);
  // Monotonic token to discard stale async byte-loads when tracks change fast.
  const loadTokenRef = React.useRef(0);
  // Timestamp of the last user seek — only used to suppress crossfade right after scrubbing.
  const lastSeekRef = React.useRef({ at: 0 });
  // Consecutive genuine load failures, to stop instead of looping on broken files.
  const failureCountRef = React.useRef(0);

  // Resolve a wire node to its ordered track ids (in library order) and start
  // playing it as the new queue — from the first track going forward, or the
  // last track when arriving by rewind. Returns false when the node yields
  // nothing to play (empty/deleted, or an unhandled video). Stable identity;
  // reads everything from refs so the transport callbacks never re-subscribe.
  const playSource = React.useCallback((node: NodeRef, fromStart: boolean): boolean => {
    if (node.kind === 'video') {
      // Video lives outside the audio engine; hand off to App's registered
      // handler. If it takes over, audio yields (the "video pauses music" rule).
      const handler = videoWireHandlerRef.current;
      if (handler && handler(node)) {
        activeSourceRef.current = node;
        setIsPlaying(false);
        return true;
      }
      return false;
    }

    if (node.kind === 'youtube') {
      // YouTube plays in a cross-origin iframe, also outside the engine. Same
      // handoff contract as video: if the handler takes over, audio yields.
      const handler = youtubeWireHandlerRef.current;
      if (handler && handler(node)) {
        activeSourceRef.current = node;
        setIsPlaying(false);
        return true;
      }
      return false;
    }

    const pl = playlistRef.current;
    let ids: string[];
    if (node.kind === 'folder') {
      // Explorer display order (linked subfolders first, then the folder's own
      // files, name-sorted at every level) — NOT raw library order, which looks
      // like a shuffle next to the sorted window and hides the queue's real end
      // (so the onward wire seems to never fire). Subfolders whose link switch
      // is OFF are skipped entirely.
      const linked = (p: string) => !unlinkedRef.current.has(p.toLowerCase());
      ids = tracksUnderOrdered<Track>(pl, node.key, linked).map((t) => t.id);
    } else if (node.kind === 'album' || node.kind === 'artist') {
      // Derived nodes: the key is an album/artist NAME, resolved against the
      // library. Handled before the playlist branch below, which would otherwise
      // look these names up as playlist ids and silently yield nothing.
      ids = pinTrackIds(pl, { kind: node.kind, key: node.key });
    } else {
      const p = userPlaylistsRef.current.find((x) => x.id === node.key);
      const valid = new Set(pl.map((t) => t.id));
      ids = p ? p.trackIds.filter((id) => valid.has(id)) : [];
    }
    if (ids.length === 0) return false;

    queueRef.current = ids;
    setQueue(ids);
    activeSourceRef.current = node;
    setCurrentTrackId(fromStart ? ids[0] : ids[ids.length - 1]);
    setIsPlaying(true);
    return true;
  }, []);

  // Step through the active queue in the given direction. Stable identity
  // (reads everything from refs) so it never re-subscribes event listeners.
  const advance = React.useCallback((dir: 1 | -1) => {
    const pl = playlistRef.current;
    const masterIds = pl.map((t) => t.id);

    // At a queue boundary, a wire carries playback into the linked source —
    // forward off the end, backward off the start (rewind). Checked before the
    // usual wrap so a wired chain plays end-to-end. Shuffle ignores wires.
    if (!shuffleRef.current && activeSourceRef.current) {
      const q = resolveQueue(masterIds, queueRef.current);
      const pos = currentTrackRef.current ? q.indexOf(currentTrackRef.current.id) : -1;
      if (dir === 1 && pos === q.length - 1) {
        const nxt = nextNode(wiresRef.current, activeSourceRef.current);
        if (nxt && playSource(nxt, true)) return;
      } else if (dir === -1 && pos === 0) {
        const prv = prevNode(wiresRef.current, activeSourceRef.current);
        if (prv && playSource(prv, false)) return;
      }
    }

    const nextId = pickAdjacent({
      masterIds,
      queue: queueRef.current,
      currentId: currentTrackRef.current?.id ?? null,
      dir,
      shuffle: shuffleRef.current,
    });
    if (!nextId) return;
    setCurrentTrackId(nextId);
  }, [playSource]);

  const playNext = React.useCallback(() => advance(1), [advance]);
  const playPrev = React.useCallback(() => advance(-1), [advance]);

  // Spawns a detached copy of the current track that fades out over `cf` seconds,
  // so the main element is free to start the next track (which fades in).
  const startTailFade = React.useCallback((audio: HTMLAudioElement, cf: number) => {
    try {
      if (tailIntervalRef.current) {
        clearInterval(tailIntervalRef.current);
        tailIntervalRef.current = null;
      }
      if (tailRef.current) {
        tailRef.current.pause();
        tailRef.current.removeAttribute('src');
      }

      const tail = new Audio();
      tail.preload = 'auto';
      const pos = audio.currentTime;
      const startVol = audio.volume;
      tail.volume = startVol;
      tail.playbackRate = audio.playbackRate;
      tail.addEventListener('loadedmetadata', () => {
        try {
          tail.currentTime = pos;
        } catch (e) { /* not seekable, play from wherever */ }
        tail.play().catch(() => {});
      }, { once: true });
      tail.src = audio.src;
      tail.load();
      tailRef.current = tail;

      const stepMs = 50;
      const steps = Math.max(1, Math.round((cf * 1000) / stepMs));
      let i = 0;
      tailIntervalRef.current = window.setInterval(() => {
        i++;
        tail.volume = Math.max(0, startVol * (1 - i / steps));
        if (i >= steps) {
          if (tailIntervalRef.current) clearInterval(tailIntervalRef.current);
          tailIntervalRef.current = null;
          tail.pause();
          tail.removeAttribute('src');
          if (tailRef.current === tail) tailRef.current = null;
        }
      }, stepMs);
    } catch (e) {
      console.warn('Crossfade tail failed:', e);
    }
  }, []);

  React.useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      try {
        (audio as any).referrerPolicy = "no-referrer";
      } catch (e) {
        console.warn("Could not set referrerPolicy on Audio element");
      }
      audio.preload = "auto";
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);

      // Crossfade: when the track is about to end, hand the tail off to a
      // fading copy and advance to the next track early (it fades in).
      // Suppressed right after a seek so scrubbing near the end doesn't
      // instantly jump to the next track.
      const cf = crossfadeRef.current;
      const hasNext = repeatMode === 'all' || shuffle || currentIndex < playlist.length - 1;
      if (
        cf > 0 &&
        !crossfadeTriggeredRef.current &&
        isPlayingRef.current &&
        repeatMode !== 'one' &&
        hasNext &&
        Date.now() - lastSeekRef.current.at > 1000 &&
        isFinite(audio.duration) &&
        audio.duration > cf * 2 && // skip crossfade on very short tracks
        audio.duration - audio.currentTime <= cf
      ) {
        crossfadeTriggeredRef.current = true;
        startTailFade(audio, cf);
        fadeInPendingRef.current = true;
        playNext();
      }
    };
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      // Queue-aware "is there a next track?" so repeat-off stops at the end of
      // the list the user is playing, not the end of the master array.
      const pl = playlistRef.current;
      const atEnd = isLastInQueue(
        pl.map((t) => t.id),
        queueRef.current,
        currentTrackRef.current?.id ?? null
      );

      if (repeatMode === 'all' || shuffleRef.current || !atEnd) {
        playNext();
      } else {
        // True end of the queue, repeat off: follow a forward wire into the next
        // linked source if one exists, otherwise stop.
        const nxt = nextNode(wiresRef.current, activeSourceRef.current);
        if (!(nxt && playSource(nxt, true))) setIsPlaying(false);
      }
    };

    // Because playback runs from a fully-loaded in-memory blob, seeking cannot
    // produce media errors. An error here means the file genuinely won't decode
    // (corrupt/unsupported). Advance past it while playing, but stop after a few
    // consecutive failures so a bad run can never become an infinite skip loop.
    const handleError = () => {
      const error = audio.error;
      const trackId = currentTrackRef.current?.id;
      console.error(`Audio decode error: code=${error?.code} message="${error?.message}" track=${trackId}`);

      if (!isPlayingRef.current || !trackId) return;

      failureCountRef.current++;
      if (failureCountRef.current >= 3) {
        console.error('Multiple tracks failed to decode. Stopping to avoid a skip loop.');
        setIsPlaying(false);
        return;
      }
      // Only auto-advance if there's somewhere to go.
      if (repeatMode === 'all' || shuffle || currentIndex < playlist.length - 1) {
        playNext();
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [playNext, playSource, repeatMode, currentIndex, playlist.length, shuffle, startTailFade]);

  const initAudioContext = React.useCallback(() => {
    if (!audioContextRef.current && audioRef.current) {
      console.log('Initializing AudioContext...');
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      
      try {
        const source = ctx.createMediaElementSource(audioRef.current);
        const graph = createAudioGraph(ctx, source, {
          eq,
          distortion,
          normalize: normalizeVolume,
        });

        audioContextRef.current = ctx;
        setAnalyser(graph.analyser);
        sourceRef.current = source;
        bassFilterRef.current = graph.bass;
        midFilterRef.current = graph.mid;
        trebleFilterRef.current = graph.treble;
        distortionNodeRef.current = graph.distortion;
        compressorRef.current = graph.compressor;
        normGainRef.current = graph.normGain;
        fadeGainRef.current = graph.fadeGain;

        // Splice reverb/delay/width in ahead of the analyser, so the FX rack's
        // spectrum shows what you actually hear. If this throws or declines to
        // insert, the chain built above is still fully connected.
        spatialFx.attachSpatialFx(ctx, graph.fadeGain, graph.analyser);

        console.log('AudioContext initialized successfully');
      } catch (err) {
        console.error('Failed to create MediaElementSource:', err);
      }
    } else if (audioContextRef.current?.state === 'suspended') {
      console.log('Resuming AudioContext...');
      audioContextRef.current.resume();
    }
    // attachSpatialFx is stable (useCallback with no deps) and the body only
    // runs once anyway, so the existing dep list stays as it was.
  }, [eq, distortion, normalizeVolume, spatialFx.attachSpatialFx]);

  // Apply normalization toggle to the live nodes
  React.useEffect(() => {
    if (compressorRef.current && normGainRef.current) {
      applyNormalization(compressorRef.current, normGainRef.current, normalizeVolume);
    }
  }, [normalizeVolume]);

  // Sleep timer: pause playback when the deadline passes
  React.useEffect(() => {
    if (!sleepDeadline) return;
    const iv = window.setInterval(() => {
      if (Date.now() >= sleepDeadline) {
        setIsPlaying(false);
        setSleepDeadline(null);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [sleepDeadline]);

  const setSleepTimer = (minutes: number | null) => {
    setSleepDeadline(minutes ? Date.now() + minutes * 60_000 : null);
  };

  const updateEq = (type: 'bass' | 'mid' | 'treble', value: number) => {
    setEq(prev => ({ ...prev, [type]: value }));
    if (type === 'bass' && bassFilterRef.current) bassFilterRef.current.gain.value = value;
    if (type === 'mid' && midFilterRef.current) midFilterRef.current.gain.value = value;
    if (type === 'treble' && trebleFilterRef.current) trebleFilterRef.current.gain.value = value;
  };

  const updateDistortion = (value: number) => {
    setDistortion(value);
    if (distortionNodeRef.current) {
      distortionNodeRef.current.curve = makeDistortionCurve(value);
    }
  };

  // Build the actual playable source for a track. Strategy lives in
  // src/audio/playbackSource.ts; this only injects the IPC bridge. 'buffer' is
  // the default because blob: URLs are unconditionally seekable. 'stream' is
  // opt-in until range-request seeking is proven on real files.
  const resolvePlayableSrc = React.useCallback(
    (track: Track): Promise<PlayableSource> =>
      resolvePlayableSource(track, streamPlayback ? 'stream' : 'buffer', {
        readAudioFile: (window as any).electronAPI?.readAudioFile,
      }),
    [streamPlayback]
  );

  const tryPlay = React.useCallback((audio: HTMLAudioElement) => {
    const start = () =>
      audio.play().catch((error) => {
        if (error.name === 'NotAllowedError') {
          console.warn('Playback blocked until user interaction.');
          setIsPlaying(false);
        } else if (error.name !== 'AbortError') {
          console.error('play() rejected:', error);
        }
      });
    if (audio.readyState >= 2) start();
    else audio.addEventListener('canplay', start, { once: true });
  }, []);

  // Load the current track's source only when the track actually changes;
  // reflect play/pause without ever reloading the element. This is the whole
  // fix for the seek/skip loop: pausing and seeking never touch the source.
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Same source already loaded → just honor the play/pause state.
    if (loadedTrackIdRef.current === currentTrack.id) {
      if (isPlaying) {
        initAudioContext();
        tryPlay(audio);
      } else if (!audio.paused) {
        audio.pause();
      }
      return;
    }

    // New track → load fresh bytes and assign a new source.
    loadedTrackIdRef.current = currentTrack.id;
    crossfadeTriggeredRef.current = false;
    const token = ++loadTokenRef.current;
    const track = currentTrack;

    const armFadeGain = () => {
      const ctx = audioContextRef.current;
      const fadeGain = fadeGainRef.current;
      if (!ctx || !fadeGain) return;
      if (fadeInPendingRef.current && crossfadeRef.current > 0) {
        fadeInPendingRef.current = false;
        const cf = crossfadeRef.current;
        fadeGain.gain.cancelScheduledValues(ctx.currentTime);
        fadeGain.gain.setValueAtTime(0.0001, ctx.currentTime);
        audio.addEventListener(
          'playing',
          () => {
            fadeGain.gain.cancelScheduledValues(ctx.currentTime);
            fadeGain.gain.setValueAtTime(0.0001, ctx.currentTime);
            fadeGain.gain.linearRampToValueAtTime(1, ctx.currentTime + cf);
          },
          { once: true }
        );
      } else {
        fadeInPendingRef.current = false;
        fadeGain.gain.cancelScheduledValues(ctx.currentTime);
        fadeGain.gain.setValueAtTime(1, ctx.currentTime);
      }
    };

    (async () => {
      try {
        const { src, isObjectUrl } = await resolvePlayableSrc(track);
        // A newer load superseded this one while we were reading bytes.
        if (token !== loadTokenRef.current) {
          if (isObjectUrl) URL.revokeObjectURL(src);
          return;
        }

        if (!audio.paused) audio.pause();

        const prev = objectUrlRef.current;
        objectUrlRef.current = isObjectUrl ? src : null;

        audio.src = src;
        audio.load();
        armFadeGain();
        failureCountRef.current = 0;

        // Revoke the previous blob we created, deferred so an in-flight
        // crossfade tail (which copied the old src) can finish using it.
        if (prev) {
          const delay = crossfadeRef.current > 0 ? crossfadeRef.current * 1000 + 500 : 0;
          setTimeout(() => URL.revokeObjectURL(prev), delay);
        }

        if (isPlayingRef.current) {
          initAudioContext();
          tryPlay(audio);
        }
      } catch (err) {
        if (token !== loadTokenRef.current) return;
        console.error(`Failed to load "${track.name}":`, err);
        if (isPlayingRef.current) {
          failureCountRef.current++;
          const hasNext = repeatMode === 'all' || shuffle || currentIndex < playlist.length - 1;
          if (failureCountRef.current < 3 && hasNext) playNext();
          else setIsPlaying(false);
        }
      }
    })();
  }, [
    currentTrack?.id,
    isPlaying,
    initAudioContext,
    resolvePlayableSrc,
    tryPlay,
    playNext,
    repeatMode,
    shuffle,
    currentIndex,
    playlist.length,
  ]);

  // Revoke any outstanding blob URL when the hook unmounts.
  React.useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Neighbour warming (next AND previous). Additive and deliberately isolated:
  // this effect only reads state and calls a fire-and-forget IPC. It does NOT
  // touch the load effect above, the blob URL lifecycle, or the crossfade tail —
  // a track change works identically whether a warm ran, failed, or never fired.
  //
  // The problem it addresses: 'buffer' mode can only start reading the file once
  // you press next/prev, so the whole disk read sits on the critical path between
  // the keypress and the first sample. Main pulls the neighbouring files through
  // the OS page cache in the background; the real read then comes from RAM. This
  // removes the disk portion of the delay, not the IPC/Blob copies.
  //
  // Why prev is worth warming even though it was just played: usually its bytes
  // ARE still cached and the warm costs almost nothing, so this is self-
  // balancing — cheap exactly when it's redundant, valuable exactly when it
  // isn't (jumping into the middle of a queue, or coming back after enough
  // tracks that the page cache evicted it).
  //
  // Bounded so a long session can't grow it without limit. Paths, not ids,
  // because that's what the warm is keyed on in main.
  const warmedPathsRef = React.useRef<string[]>([]);
  const WARMED_MEMORY = 16;
  React.useEffect(() => {
    // Streaming never does a full read, so there is nothing to warm.
    if (streamPlayback) return;
    // Shuffle picks its next track at the moment of advancing — warming forward
    // would just be a wrong guess. (Prev is still knowable, but skipping both
    // keeps this one flag = one behaviour, and shuffle listeners rarely rewind.)
    if (shuffle) return;
    if (!currentTrack) return;
    const warmAudioFile = (window as any).electronAPI?.warmAudioFile;
    if (!warmAudioFile) return; // browser / older preload: silently skip

    let cancelled = false;

    /** The on-disk path of the adjacent track in `dir`, if there's one to warm. */
    const neighbourPath = (dir: 1 | -1): string | null => {
      const pl = playlistRef.current;
      const id = pickAdjacent({
        masterIds: pl.map((t) => t.id),
        queue: queueRef.current,
        currentId: currentTrackRef.current?.id ?? null,
        dir,
        shuffle: false,
      });
      if (!id) return null;
      const t = pl.find((x) => x.id === id);
      // Only on-disk tracks have something to warm; uploads are already in memory.
      if (!t || !isNativeTrack(t) || !t.nativePath) return null;
      return t.nativePath;
    };

    const warm = async (path: string | null) => {
      if (cancelled || !path) return;
      if (warmedPathsRef.current.includes(path)) return;
      warmedPathsRef.current.push(path);
      if (warmedPathsRef.current.length > WARMED_MEMORY) warmedPathsRef.current.shift();
      try {
        await warmAudioFile(path);
      } catch {
        /* a warm failing is not an error worth surfacing */
      }
    };

    // Wait until the current track has had time to load. Warming immediately
    // would put a big background read in front of the one the user is waiting on.
    const timer = window.setTimeout(() => {
      // Sequential, next first: forward is far more likely, and two concurrent
      // whole-file reads would just contend for the same disk.
      void (async () => {
        await warm(neighbourPath(1));
        await warm(neighbourPath(-1));
      })();
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack?.id, streamPlayback, shuffle]);

  const togglePlay = () => {
    if (!currentTrack) return;
    initAudioContext();
    setIsPlaying(!isPlaying);
  };

  // `index` is the master-playlist index of the clicked track. `orderedIds` is
  // the order of the list the user clicked from (sorted/filtered view) — it
  // becomes the play queue so next/prev follow what they see. `source` records
  // which desktop object (folder/playlist) the list came from, so wires can
  // carry playback on from here; omit it for unwired sources (library/spotlight).
  const playTrack = (index: number, orderedIds?: string[], source?: NodeRef) => {
    if (index < 0 || index >= playlist.length) return;
    queueRef.current = orderedIds && orderedIds.length > 0 ? orderedIds : playlist.map((t) => t.id);
    setQueue(queueRef.current);
    activeSourceRef.current = source ?? null;
    initAudioContext();
    setCurrentTrackId(playlist[index].id);
    setIsPlaying(true);
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    lastSeekRef.current = { at: Date.now() };
    try {
      // Blob source is fully in memory, so this is instant and cannot error.
      audio.currentTime = time;
    } catch (e) {
      console.warn('Seek failed:', e);
    }
    setProgress(time);
  };

  // Library mutations (import, remove, dedupe, playlists) live in useMediaLibrary.
  // Only removeDuplicates needs the playing track's id for its "keep current"
  // scoring, so it gets a thin wrapper here.
  const removeDuplicates = () => library.removeDuplicates(currentTrackRef.current?.id ?? null);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // defaultPlaybackRate too, because changing src resets playbackRate to the default
  React.useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = playbackRate;
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate, currentTrack?.id]);

  return {
    playlist,
    currentTrack,
    currentIndex,
    isPlaying,
    progress,
    duration,
    diskUsage,
    analyser,
    queue,
    togglePlay,
    playTrack,
    playNext,
    playPrev,
    seek,
    addFiles: library.addFiles,
    addNativeFiles: library.addNativeFiles,
    removeTrack: library.removeTrack,
    removeDuplicates,
    updateTrackDetails: library.updateTrackDetails,
    isMuted,
    volume,
    shuffle,
    repeatMode,
    toggleMute,
    toggleShuffle: () => setShuffle(prev => !prev),
    toggleRepeat: () => {
      const modes: ('none' | 'one' | 'all')[] = ['none', 'all', 'one'];
      const nextIndex = (modes.indexOf(repeatMode) + 1) % modes.length;
      setRepeatMode(modes[nextIndex]);
    },
    setVolume,
    playbackRate,
    setPlaybackRate,
    crossfade,
    setCrossfade,
    normalizeVolume,
    setNormalizeVolume,
    streamPlayback,
    setStreamPlayback,
    sleepDeadline,
    setSleepTimer,
    eq,
    distortion,
    updateEq,
    updateDistortion,
    // Spatial FX (reverb / delay / stereo width) — added, never replacing.
    ...spatialFx,
    userPlaylists,
    createPlaylist: library.createPlaylist,
    renamePlaylist: library.renamePlaylist,
    addTrackToPlaylist: library.addTrackToPlaylist,
    removeTrackFromPlaylist: library.removeTrackFromPlaylist,
    deletePlaylist: library.deletePlaylist,
    // Wire graph (owned by the library) + the video-handoff registration.
    wires,
    addWire: library.addWire,
    removeWire: library.removeWire,
    removeNodeWires: library.removeNodeWires,
    // Per-subfolder link switches (owned by the library; the engine reads them
    // when a wire resolves a folder node — see playSource).
    unlinkedFolders,
    toggleFolderLink: library.toggleFolderLink,
    setVideoWireHandler: React.useCallback(
      (fn: ((node: NodeRef) => boolean) | null) => {
        videoWireHandlerRef.current = fn;
      },
      []
    ),
    setYouTubeWireHandler: React.useCallback(
      (fn: ((node: NodeRef) => boolean) | null) => {
        youtubeWireHandlerRef.current = fn;
      },
      []
    ),
    // Resume audio playback at a wire node (folder/playlist). Used when a video
    // finishes and the wire hands the chain back to the music engine.
    playWireNode: React.useCallback((node: NodeRef) => playSource(node, true), [playSource]),
  };
};
