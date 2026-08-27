import React from 'react';
import { usePersistentState } from './usePersistentState';
import type { Station } from '../types';

// EXPERIMENTAL internet-radio layer. A parallel stack to the audio engine, in the
// same spirit as the video layer: it owns its OWN <audio> element and never
// touches useAudioPlayer, the play queue, the wire graph, or the EQ/crossfade
// graph. The only coupling lives in App (starting a station pauses music; starting
// music stops the station).
//
// A station is just a live stream URL. Live streams have no duration and aren't
// seekable, so there is no progress/seek here — only play/stop and a playing flag.

export interface StationsApi {
  stations: Station[];
  addStation: (name: string, streamUrl: string) => void;
  removeStation: (id: string) => void;
  renameStation: (id: string, name: string) => void;
  /** Id of the station currently loaded in the dedicated element, or null. */
  currentStationId: string | null;
  currentStation: Station | null;
  /** True while the stream is actually producing audio. */
  playing: boolean;
  /** True when the last load/connection failed (dead URL, offline, CORS). */
  error: boolean;
  /** True between play() and the stream actually starting. */
  connecting: boolean;
  /** Current-track title from ICY metadata (Electron only), or null. */
  nowPlayingTitle: string | null;
  /** Start a station (stops any other station first). */
  playStation: (id: string) => void;
  /** Stop and unload the current station. */
  stop: () => void;
}

// Shape returned by the `station-metadata` IPC (see electron/icyMetadata.cjs).
interface StationMeta {
  title: string | null;
  name: string | null;
  homepage: string | null;
  favicon: string | null;
}

// How often to re-poll the live now-playing title while a station plays.
const META_POLL_MS = 20_000;

const STORAGE_KEY = 'brutal-stations';

let idCounter = 0;
const newId = () => `stn_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function useStations(): StationsApi {
  const [stations, setStations] = usePersistentState<Station[]>(STORAGE_KEY, []);
  const [currentStationId, setCurrentStationId] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [nowPlayingTitle, setNowPlayingTitle] = React.useState<string | null>(null);

  // Dedicated element, created lazily and kept for the hook's lifetime. Separate
  // from the music engine's <audio> so radio and library playback never share
  // state — stopping one can't disturb the other.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    const audio = new Audio();
    try {
      (audio as any).referrerPolicy = 'no-referrer';
    } catch {
      /* older engines: fine without it */
    }
    // Live streams: don't try to buffer ahead aggressively, and never loop.
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    const onPlaying = () => {
      setPlaying(true);
      setConnecting(false);
      setError(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setConnecting(true);
    const onError = () => {
      setError(true);
      setPlaying(false);
      setConnecting(false);
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  const stop = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Fully disconnect from the stream — pausing alone keeps the socket open.
      audio.removeAttribute('src');
      audio.load();
    }
    setPlaying(false);
    setConnecting(false);
    setNowPlayingTitle(null);
    setCurrentStationId(null);
  }, []);

  const playStation = React.useCallback(
    (id: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      const station = stations.find((s) => s.id === id);
      if (!station) return;

      setError(false);
      setConnecting(true);
      setNowPlayingTitle(null);
      setCurrentStationId(id);
      // Assigning a fresh src (even the same URL) reconnects the live stream.
      audio.src = station.streamUrl;
      audio.load();
      audio.play().catch((e) => {
        // Autoplay policy blocks until a user gesture; double-click is one, so this
        // should normally succeed. Anything else is a genuine connect failure.
        if (e?.name !== 'AbortError') {
          console.warn('Station play() rejected:', e);
          setError(true);
          setConnecting(false);
        }
      });
    },
    [stations]
  );

  const addStation = React.useCallback(
    (name: string, streamUrl: string) => {
      const n = name.trim();
      const url = streamUrl.trim();
      if (!url) return;
      const station: Station = {
        id: newId(),
        name: n || url,
        streamUrl: url,
        createdAt: Date.now(),
      };
      setStations((prev) => [...prev, station]);
    },
    [setStations]
  );

  const removeStation = React.useCallback(
    (id: string) => {
      // Stop first if we're removing the one that's playing.
      setCurrentStationId((cur) => {
        if (cur === id) {
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
          }
          setPlaying(false);
          setConnecting(false);
          return null;
        }
        return cur;
      });
      setStations((prev) => prev.filter((s) => s.id !== id));
    },
    [setStations]
  );

  const renameStation = React.useCallback(
    (id: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      setStations((prev) => prev.map((s) => (s.id === id ? { ...s, name: n } : s)));
    },
    [setStations]
  );

  const currentStation = React.useMemo(
    () => stations.find((s) => s.id === currentStationId) ?? null,
    [stations, currentStationId]
  );

  // ICY now-playing + favicon. Electron-only (needs the main-process fetch); in a
  // plain browser electronAPI is absent and this simply no-ops. Polls while a
  // station is actually playing, and back-fills the tile favicon once.
  React.useEffect(() => {
    const fetchMeta: ((url: string) => Promise<StationMeta | null>) | undefined = (
      window as any
    ).electronAPI?.stationMetadata;
    if (!fetchMeta || !currentStation || !playing) return;

    let cancelled = false;
    const url = currentStation.streamUrl;
    const stationId = currentStation.id;
    const hasFavicon = !!currentStation.faviconUrl;

    const poll = async () => {
      try {
        const meta = await fetchMeta(url);
        if (cancelled || !meta) return;
        setNowPlayingTitle(meta.title);
        // First time only: adopt the station's real favicon for its desktop tile.
        if (!hasFavicon && meta.favicon) {
          setStations((prev) =>
            prev.map((s) =>
              s.id === stationId && !s.faviconUrl ? { ...s, faviconUrl: meta.favicon! } : s
            )
          );
        }
      } catch {
        /* leave the last known title in place */
      }
    };

    poll();
    const iv = window.setInterval(poll, META_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [currentStation, playing, setStations]);

  return {
    stations,
    addStation,
    removeStation,
    renameStation,
    currentStationId,
    currentStation,
    playing,
    error,
    connecting,
    nowPlayingTitle,
    playStation,
    stop,
  };
}
