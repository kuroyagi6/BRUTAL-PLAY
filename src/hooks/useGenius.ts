// The MEANING corner's data layer: fetch a song's Genius annotations once, then
// map them onto whatever lines the Lyrics view is showing. Contained — it
// composes the pure resolver (services/geniusMeaning) with the IPC transport and
// touches neither the audio engine nor useAudioPlayer's return shape. It also
// never writes to the track: a meaning is commentary, not lyrics, so nothing
// here can corrupt what LRCLIB/your .lrc files put on the song.
//
// Two gates, both off by default: an opt-in flag AND the user's own Genius
// Client Access Token. Without a token there is no request to make.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../types';
import {
  resolveSongAnnotations,
  matchAnnotations,
  isQueryable,
  meaningsKey,
  MEANINGS_VERSION,
  type Annotation,
  type GeniusSong,
  type SongAnnotations,
  type SongQuery,
  type StoredMeanings,
} from '../services/geniusMeaning';
import { getMeanings, saveMeanings, deleteMeanings } from '../services/dbService';
import { makeFlagHook } from './useLocalFlag';

/** Opt-in for the whole feature. Separate from the lyrics flag: different data
 *  to a different service, and this one needs a credential. */
export const useGeniusMeaning = makeFlagHook('brutal-geniusMeaning');

export const GENIUS_TOKEN_KEY = 'brutal-geniusToken';
const TOKEN_EVENT = `${GENIUS_TOKEN_KEY}-changed`;

function readToken(): string {
  try {
    return localStorage.getItem(GENIUS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * The user's Genius Client Access Token, kept in localStorage and broadcast so
 * Settings and the Lyrics window agree instantly. It is a read-only,
 * user-generated app token — not a login — and it never leaves the machine
 * except as the Authorization header on api.genius.com requests.
 */
export function useGeniusToken(): [string, (v: string) => void] {
  const [token, setToken] = useState<string>(readToken);

  useEffect(() => {
    const sync = () => setToken(readToken());
    window.addEventListener(TOKEN_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TOKEN_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const set = useCallback((v: string) => {
    const clean = (v || '').trim();
    try {
      if (clean) localStorage.setItem(GENIUS_TOKEN_KEY, clean);
      else localStorage.removeItem(GENIUS_TOKEN_KEY);
    } catch {
      /* ignore quota/denied */
    }
    setToken(clean);
    window.dispatchEvent(new Event(TOKEN_EVENT));
  }, []);

  return [token, set];
}

export type MeaningStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'not-found'
  | 'no-token'
  | 'offline'
  | 'error';

export interface UseGeniusMeanings {
  status: MeaningStatus;
  error: string | null;
  song: GeniusSong | null;
  /** annotations aligned to the lines passed in: byLine[i] covers line i. */
  byLine: (Annotation | null)[];
  /** How many of this song's annotations landed on a line. */
  matched: number;
  /** Total annotations Genius has for the song. */
  total: number;
  fetchNow: () => void;
  /** False when the track has no usable title/artist to search on. */
  canFetch: boolean;
  /** True when what's shown came off disk rather than the network. */
  fromCache: boolean;
  /** When the cached copy was fetched (ms epoch), for the offline readout. */
  cachedAt: number | null;
}

/** The IPC-backed JSON getter, with the bearer token attached. Undefined outside
 *  Electron (browser preview) or without a token. */
function bridgeGetter(token: string): ((url: string) => Promise<any>) | undefined {
  const api = (window as any).electronAPI;
  if (!api?.httpGetJson || !token) return undefined;
  return (url: string) => api.httpGetJson(url, { bearer: token });
}

// In-memory layer in FRONT of the IndexedDB cache, keyed by song (not track id).
// Skipping back and forth between two songs shouldn't cost a disk read each way.
const memo = new Map<string, StoredMeanings>();

const queryOf = (t: Track): SongQuery => ({ artist: t.artist || '', track: t.name || '' });

/** When this renderer started — anything cached before it was read from disk. */
const SESSION_START = Date.now();

/** A stored row is only usable if a current-version resolver wrote it. */
const usable = (row: StoredMeanings | undefined): row is StoredMeanings =>
  !!row && (row.v ?? 0) >= MEANINGS_VERSION;

export function useGeniusMeanings(
  track: Track | null,
  lines: string[],
  enabled: boolean,
  auto: boolean
): UseGeniusMeanings {
  const [status, setStatus] = useState<MeaningStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<StoredMeanings | null>(null);
  const [token] = useGeniusToken();

  // Drops a slow response (or disk read) after the user skips on, so one song's
  // annotations can't be rendered against another song's lines.
  const runFor = useRef<string | null>(null);
  // Songs whose network lookup already failed this session, so a genuine error
  // doesn't re-request on every render. Cleared by the explicit RETRY.
  const attempted = useRef<Set<string>>(new Set());

  const canFetch = !!track && isQueryable(queryOf(track));
  const key = track && canFetch ? meaningsKey(queryOf(track)) : null;

  const apply = useCallback((r: StoredMeanings) => {
    setRow(r);
    setStatus(r.annotations.length ? 'ready' : 'not-found');
  }, []);

  // The network path. Only ever reached on a cache miss (or an explicit RETRY),
  // which is the whole point: a song already on disk never touches Genius again.
  const run = useCallback(
    async (t: Track) => {
      if (!isQueryable(queryOf(t))) return;
      const k = meaningsKey(queryOf(t));
      if (!token) {
        setStatus('no-token');
        return;
      }
      const get = bridgeGetter(token);
      if (!get) {
        setStatus('offline');
        return;
      }

      runFor.current = t.id;
      attempted.current.add(k);
      setStatus('loading');
      setError(null);

      try {
        const res: SongAnnotations | null = await resolveSongAnnotations(queryOf(t), get);
        const stored: StoredMeanings = {
          key: k,
          song: res?.song ?? null,
          annotations: res?.annotations ?? [],
          notFound: !res || res.annotations.length === 0,
          fetchedAt: Date.now(),
          v: MEANINGS_VERSION,
        };
        memo.set(k, stored);
        // Persist even a miss: on a machine that's usually offline, "Genius has
        // nothing for this song" is an answer worth keeping too.
        saveMeanings(stored).catch(() => {
          /* cache write failed — the session still has it in memo */
        });
        if (runFor.current !== t.id) return;
        apply(stored);
      } catch (e) {
        if (runFor.current !== t.id) return;
        const msg = e instanceof Error ? e.message : 'lookup failed';
        setError(msg);
        // A 401/403 means the token is missing or wrong — worth saying plainly
        // rather than as a generic failure. Nothing is cached on a failure: a
        // request that never landed is not an answer about the song.
        setStatus(/40[13]/.test(msg) ? 'no-token' : 'error');
      }
    },
    [token, apply]
  );

  const fetchNow = useCallback(() => {
    if (!track || !key) return;
    attempted.current.delete(key);
    memo.delete(key);
    deleteMeanings(key).catch(() => {
      /* nothing stored, or the db is unavailable — refetch anyway */
    });
    run(track);
  }, [track, key, run]);

  // On track change: memory, then disk, then idle. The disk read runs whenever
  // the feature is on — it's local, so it costs nothing and needs no connection,
  // and it's what makes a previously-seen song work with the network down.
  useEffect(() => {
    runFor.current = track?.id ?? null;
    setError(null);

    if (!track || !key || !enabled) {
      setRow(null);
      setStatus('idle');
      return;
    }

    const hit = memo.get(key);
    if (usable(hit)) {
      apply(hit);
      return;
    }

    setRow(null);
    setStatus('idle');

    let cancelled = false;
    getMeanings(key)
      .then((stored) => {
        if (cancelled || runFor.current !== track.id) return;
        if (!usable(stored)) return;
        memo.set(key, stored);
        apply(stored);
      })
      .catch(() => {
        /* no cache available — the fetch path below is the fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [track?.id, key, enabled, apply]);

  // Auto-fetch: only for a song with nothing cached (`status` is still 'idle'
  // once the disk read has come back empty) and not already tried this session.
  useEffect(() => {
    if (!enabled || !auto || !track || !key || !canFetch || !token) return;
    if (status !== 'idle') return;
    if (memo.has(key) || attempted.current.has(key)) return;
    run(track);
  }, [enabled, auto, track?.id, key, canFetch, token, status, run]);

  // Re-match only when the lyrics or the annotation set actually change. The
  // caller re-renders on every progress tick, and matching 200 annotations
  // against 80 lines four times a second would be felt.
  const annotations = row?.annotations ?? [];
  const linesKey = lines.join('\n');
  const byLine = useMemo(
    () => (annotations.length ? matchAnnotations(lines, annotations) : lines.map(() => null)),
    [row, linesKey]
  );
  const matched = byLine.reduce((n: number, a: Annotation | null) => (a ? n + 1 : n), 0);

  return {
    status,
    error,
    song: row?.song ?? null,
    byLine,
    matched,
    total: annotations.length,
    fetchNow,
    canFetch,
    // Anything showing after a reload came off disk. Within one session the
    // distinction stops mattering, so "older than this session" is close enough
    // and needs no extra bookkeeping.
    fromCache: !!row && row.fetchedAt < SESSION_START,
    cachedAt: row?.fetchedAt ?? null,
  };
}
