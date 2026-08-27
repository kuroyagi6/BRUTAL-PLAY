// Fetches synced lyrics for a track from LRCLIB and writes them onto the track.
// Contained: it composes the pure resolver (services/lyricsFetch) with the IPC
// transport and the existing `updateTrackDetails` seam, and touches nothing in
// the audio engine or useAudioPlayer's return shape. LyricsView is the only
// consumer. Off unless `enabled` — a lookup sends the title + artist to a third
// party, so the caller gates it behind a Settings opt-in.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { resolveLyrics, queryFromTrack, isQueryable } from '../services/lyricsFetch';
import { parseTimestampedLyrics } from '../utils/lrc';

export type LyricsFetchStatus =
  | 'idle'
  | 'loading'
  | 'found-synced'
  | 'found-plain'
  | 'instrumental'
  | 'not-found'
  | 'offline'
  | 'error';

export interface UseLyricsFetch {
  status: LyricsFetchStatus;
  error: string | null;
  /** Look up now, ignoring whether we already tried this track. */
  fetchNow: () => void;
  /** False when there's nothing to search on (no title, "Unknown Artist"). */
  canFetch: boolean;
}

/** The IPC-backed JSON getter; undefined outside Electron (browser preview). */
function bridgeGetter(): ((url: string) => Promise<any>) | undefined {
  const api = (window as any).electronAPI;
  return api?.httpGetJson ? (url: string) => api.httpGetJson(url) : undefined;
}

export function useLyricsFetch(
  track: Track | null,
  enabled: boolean,
  auto: boolean,
  updateTrackDetails?: (id: string, updates: Partial<Track>) => void
): UseLyricsFetch {
  const [status, setStatus] = useState<LyricsFetchStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Tracks we've already auto-attempted this session. Without this, a track with
  // genuinely no lyrics on LRCLIB would re-request on every render/track return.
  // In-memory only: a miss today may be a hit next week, so it isn't persisted.
  const attempted = useRef<Set<string>>(new Set());
  // Guards against a slow response landing after the user skipped on, which
  // would write one track's lyrics onto another.
  const runFor = useRef<string | null>(null);

  const query = track ? queryFromTrack(track) : null;
  const canFetch = !!query && isQueryable(query);
  const hasLyrics = !!(track?.lyrics || track?.syncedLyrics?.length);

  const run = useCallback(
    async (t: Track) => {
      const q = queryFromTrack(t);
      if (!isQueryable(q) || !updateTrackDetails) return;

      const get = bridgeGetter();
      if (!get) {
        setStatus('offline');
        return;
      }

      runFor.current = t.id;
      attempted.current.add(t.id);
      setStatus('loading');
      setError(null);

      try {
        const hit = await resolveLyrics(q, get);
        // The user moved on — drop the result rather than write it to the wrong track.
        if (runFor.current !== t.id) return;

        if (!hit) {
          setStatus('not-found');
          return;
        }
        if (hit.instrumental && !hit.synced && !hit.plain) {
          setStatus('instrumental');
          return;
        }

        if (hit.synced) {
          const synced = parseTimestampedLyrics(hit.synced);
          if (synced.length) {
            // Clear `lyrics` so the synced view wins — the same convention the
            // paste box uses when it detects timestamps.
            updateTrackDetails(t.id, { syncedLyrics: synced, lyrics: undefined });
            setStatus('found-synced');
            return;
          }
        }
        if (hit.plain) {
          updateTrackDetails(t.id, { lyrics: hit.plain, syncedLyrics: undefined });
          setStatus('found-plain');
          return;
        }
        setStatus('not-found');
      } catch (e) {
        if (runFor.current !== t.id) return;
        setError(e instanceof Error ? e.message : 'lookup failed');
        setStatus('error');
      }
    },
    [updateTrackDetails]
  );

  const fetchNow = useCallback(() => {
    if (track) run(track);
  }, [track, run]);

  // Reset the badge when the track changes, so a "NOT FOUND" from the last song
  // doesn't hang over the next one.
  useEffect(() => {
    setStatus('idle');
    setError(null);
    runFor.current = track?.id ?? null;
  }, [track?.id]);

  // Auto-fetch: only for a track that has no lyrics at all and hasn't been tried.
  useEffect(() => {
    if (!enabled || !auto || !track || hasLyrics || !canFetch) return;
    if (attempted.current.has(track.id)) return;
    run(track);
  }, [enabled, auto, track, hasLyrics, canFetch, run]);

  return { status, error, fetchNow, canFetch };
}
