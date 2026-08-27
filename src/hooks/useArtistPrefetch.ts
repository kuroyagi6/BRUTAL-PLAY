// Walks the library once and resolves an artist profile (photo + bio + tags) for
// every credited artist, filling the cache that Spotlight reads. Without this,
// photos only ever appear for artists whose ARTIST tab you happened to open, so
// most rows stay iconless forever.
//
// Contained: composes the pure resolver + the IPC transport + the cache, and
// touches nothing in the audio engine. Runs ONLY when the user presses the
// button in Settings — it makes one network request per artist, so it is never
// automatic.
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveArtistProfile, PROFILE_VERSION, type JsonGetter } from '../services/artistProfile';
import { getArtistProfile, saveArtistProfile } from '../services/dbService';
import { collectArtists } from '../utils/artistCredits';

export interface PrefetchProgress {
  running: boolean;
  /** Artists processed so far this run. */
  done: number;
  /** Artists this run has to process (already-cached ones are excluded). */
  total: number;
  /** Lookups that errored — the walk continues past them. */
  failed: number;
  /** Name currently being resolved, for the progress line. */
  current: string | null;
  /** Set when the whole walk aborted (offline), not when one artist failed. */
  error: string | null;
}

const IDLE: PrefetchProgress = {
  running: false,
  done: 0,
  total: 0,
  failed: 0,
  current: null,
  error: null,
};

function bridgeGetter(): JsonGetter | undefined {
  const api = (window as any).electronAPI;
  return api?.httpGetJson ? (url: string) => api.httpGetJson(url) : undefined;
}

export interface UseArtistPrefetch extends PrefetchProgress {
  start: () => void;
  stop: () => void;
}

export function useArtistPrefetch(tracks: { artist?: string }[]): UseArtistPrefetch {
  const [progress, setProgress] = useState<PrefetchProgress>(IDLE);
  // Read inside the loop so Stop takes effect on the next artist rather than
  // after the whole library.
  const cancelled = useRef(false);
  const running = useRef(false);

  // A walk outliving its screen would keep hitting the network invisibly.
  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const stop = useCallback(() => {
    cancelled.current = true;
    setProgress((p) => ({ ...p, running: false, current: null }));
  }, []);

  const start = useCallback(() => {
    if (running.current) return;

    const get = bridgeGetter();
    if (!get) {
      setProgress({ ...IDLE, error: 'offline' });
      return;
    }

    running.current = true;
    cancelled.current = false;

    (async () => {
      try {
        const names = collectArtists(tracks);

        // Skip artists already resolved by the CURRENT resolver. Rows from an
        // older one are re-fetched: they predate the photo source, so keeping
        // them would leave those artists permanently pictureless.
        const todo: string[] = [];
        for (const n of names) {
          try {
            const cached = await getArtistProfile(n.trim().toLowerCase());
            if (!cached || (cached.v ?? 1) < PROFILE_VERSION) todo.push(n);
          } catch {
            todo.push(n);
          }
        }

        setProgress({ ...IDLE, running: true, total: todo.length });
        if (!todo.length) {
          setProgress({ ...IDLE, running: false, total: 0, done: 0 });
          return;
        }

        let done = 0;
        let failed = 0;
        for (const name of todo) {
          if (cancelled.current) break;
          setProgress({ running: true, done, total: todo.length, failed, current: name, error: null });
          try {
            const profile = await resolveArtistProfile(name, get);
            // Cached even when notFound: a stub stops the next walk from asking
            // the same hopeless question again.
            await saveArtistProfile(profile);
          } catch {
            // One bad artist (odd characters, a 503) must not end the walk.
            failed++;
          }
          done++;
        }

        setProgress({
          running: false,
          done,
          total: todo.length,
          failed,
          current: null,
          error: null,
        });
      } catch (e) {
        setProgress({
          ...IDLE,
          error: e instanceof Error ? e.message : 'prefetch failed',
        });
      } finally {
        running.current = false;
      }
    })();
  }, [tracks]);

  return { ...progress, start, stop };
}
