import { useEffect, useRef } from 'react';
import type { Track } from '../types';

/**
 * Bridges the audio transport to the OS media session (Windows SMTC / Bluetooth
 * AVRCP / wired inline-remote media keys).
 *
 * This is what makes HEADPHONE GESTURES work: when headphones are connected,
 * their button taps are delivered to the app as media-session actions, not as
 * keyboard events — so the existing keydown shortcuts never see them. The OS maps
 * the gestures like this (standard AVRCP / SMTC behaviour):
 *   - single tap   -> play / pause
 *   - double tap   -> next track
 *   - triple tap   -> previous track
 *   - press & hold -> seek (some remotes)
 * Chromium only forwards these once we register the matching action handlers.
 *
 * Contained by design (see extending-safely): a standalone hook that only reads
 * the transport + current-track state and calls back into it. It never touches
 * the audio engine or useAudioPlayer's return shape.
 */
export interface MediaSessionDeps {
  currentTrack: Track | null | undefined;
  isPlaying: boolean;
  progress: number;
  duration: number;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  seek: (seconds: number) => void;
}

export function useMediaSession(deps: MediaSessionDeps): void {
  // Always-fresh view of the transport so the action handlers (registered once)
  // never close over stale state.
  const ref = useRef(deps);
  ref.current = deps;

  // Register the action handlers exactly once. They read `ref.current`, so they
  // stay correct without being re-registered on every render.
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof ms.setActionHandler !== 'function') return;

    // `play`/`pause` come in as distinct actions (single tap toggles), but the
    // OS only sends whichever is opposite the playbackState we report — so guard
    // against double-toggling if the states ever disagree.
    const set = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler as MediaSessionActionHandler | null);
      } catch {
        /* unsupported action on this platform — ignore */
      }
    };

    set('play', () => {
      if (!ref.current.isPlaying) ref.current.togglePlay();
    });
    set('pause', () => {
      if (ref.current.isPlaying) ref.current.togglePlay();
    });
    set('nexttrack', () => ref.current.playNext());
    set('previoustrack', () => ref.current.playPrev());

    // Optional but nice with headphones that support press-and-hold seek.
    set('seekbackward', (details?: MediaSessionActionDetails) => {
      const { progress, duration } = ref.current;
      const offset = (details && details.seekOffset) || 10;
      ref.current.seek(Math.max(0, progress - offset));
      void duration;
    });
    set('seekforward', (details?: MediaSessionActionDetails) => {
      const { progress, duration } = ref.current;
      const offset = (details && details.seekOffset) || 10;
      ref.current.seek(Math.min(duration || progress + offset, progress + offset));
    });
    set('seekto', (details?: MediaSessionActionDetails) => {
      if (details && typeof details.seekTime === 'number') ref.current.seek(details.seekTime);
    });
    set('stop', () => {
      if (ref.current.isPlaying) ref.current.togglePlay();
    });

    return () => {
      // Release the handlers so a hot-reload / unmount doesn't leave the OS
      // pointing at dead closures.
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto', 'stop'] as MediaSessionAction[]) {
        set(a, null);
      }
    };
  }, []);

  // Keep the OS "now playing" panel + play/pause state in sync. Some platforms
  // won't surface the media controls (and therefore won't route gestures) until
  // metadata has been published, so this also matters for the gestures working.
  const { currentTrack, isPlaying } = deps;
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    if (!currentTrack) {
      ms.metadata = null;
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: currentTrack.name || 'Unknown',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || '',
        artwork: currentTrack.coverUrl
          ? [{ src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
    } catch {
      /* MediaMetadata unsupported — controls still work without art */
    }
  }, [currentTrack?.id, currentTrack?.name, currentTrack?.artist, currentTrack?.album, currentTrack?.coverUrl]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    ms.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Publish position so the OS scrubber tracks playback (and seekto has a range).
  const { progress, duration } = deps;
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof ms.setPositionState !== 'function') return;
    if (!duration || !isFinite(duration) || duration <= 0) return;
    try {
      ms.setPositionState({
        duration,
        position: Math.min(Math.max(0, progress), duration),
        playbackRate: 1,
      });
    } catch {
      /* invalid state (e.g. position > duration mid-transition) — ignore */
    }
  }, [progress, duration]);
}
