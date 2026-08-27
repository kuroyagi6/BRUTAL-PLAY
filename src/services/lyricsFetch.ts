// Pure LRCLIB lyrics resolver: URL builders + parsers + an orchestrator that
// sequences them through an INJECTED fetcher. No network, no React — testable
// with a fake getter (see lyricsFetch.test.ts). HTTP happens in main
// (electron/httpGet.cjs), reusing the artist-profile transport.
//
// WHY LRCLIB AND NOT GENIUS/LYRICSIFY: LRCLIB is keyless, needs no auth, and is
// built for *synced* lyrics — it returns `syncedLyrics` as raw LRC text, which
// utils/lrc.ts#parseTimestampedLyrics already parses. Genius has no timestamped
// lyrics at all and its API deliberately withholds lyric text (fetching them
// means scraping the page, against its terms). Lyricsify is scrape-only too.
// Neither can deliver a synced line without HTML scraping, so neither is here.
import type { Track } from '../types';

export const LRCLIB_HOST = 'lrclib.net';

/** What LRCLIB knows about one track. */
export interface LyricsHit {
  /** Raw LRC text with [mm:ss.xx] tokens. Feed to parseTimestampedLyrics. */
  synced?: string;
  /** Untimed fallback text. */
  plain?: string;
  /** LRCLIB flags known instrumentals — that's an answer, not a miss. */
  instrumental: boolean;
  /** Duration LRCLIB has for the matched track (seconds), for reporting. */
  duration?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
}

/** Exact lookup. Needs all four fields; 404s unless the duration is within ~2s. */
export function lrclibGetUrl(p: {
  artist: string;
  track: string;
  album: string;
  duration: number;
}): string {
  const q = new URLSearchParams({
    artist_name: p.artist,
    track_name: p.track,
    album_name: p.album,
    duration: String(Math.round(p.duration)),
  });
  return `https://${LRCLIB_HOST}/api/get?${q}`;
}

/** Broad lookup — no duration/album needed. Returns up to 20 candidates. */
export function lrclibSearchUrl(p: { artist: string; track: string }): string {
  const q = new URLSearchParams({ artist_name: p.artist, track_name: p.track });
  return `https://${LRCLIB_HOST}/api/search?${q}`;
}

/** Normalize one LRCLIB record. Returns null for a record with nothing usable. */
export function parseLyricsRecord(raw: any): LyricsHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const instrumental = raw.instrumental === true;
  const synced: string | undefined = raw.syncedLyrics || undefined;
  const plain: string | undefined = raw.plainLyrics || undefined;
  if (!instrumental && !synced && !plain) return null;
  return {
    synced,
    plain,
    instrumental,
    duration: typeof raw.duration === 'number' ? raw.duration : undefined,
    trackName: raw.trackName || undefined,
    artistName: raw.artistName || undefined,
    albumName: raw.albumName || undefined,
  };
}

/**
 * Rank search candidates and take the best.
 *
 * Synced always beats plain — a plain hit with a perfect duration is still the
 * wrong answer when a synced one exists, because synced is the whole point.
 * Duration proximity breaks the rest: LRCLIB carries several uploads per song
 * ("Creep" comes back at both 239s and 235s) and the one matching this file is
 * the one whose timings will actually line up with playback.
 */
export function pickBestLyrics(records: any[], durationSec?: number): LyricsHit | null {
  const hits = (records ?? []).map(parseLyricsRecord).filter((h): h is LyricsHit => !!h);
  if (!hits.length) return null;

  const score = (h: LyricsHit): number => {
    let s = h.synced ? 1000 : 0;
    if (durationSec && h.duration) {
      const drift = Math.abs(h.duration - durationSec);
      // Within 2s is effectively the same master; beyond ~15s it's a different
      // edit (radio cut, live version) and its timings would be useless.
      s += drift <= 2 ? 100 : drift <= 15 ? 50 - drift : -drift;
    }
    return s;
  };

  return hits.slice().sort((a, b) => score(b) - score(a))[0];
}

export interface LyricsQuery {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
}

/** Pull a lookup query out of a Track. */
export function queryFromTrack(t: Track): LyricsQuery {
  return {
    artist: (t.artist || '').trim(),
    track: (t.name || '').trim(),
    album: (t.album || '').trim() || undefined,
    duration: t.duration,
  };
}

const UNKNOWN = /^(unknown|various)/i;

/** Enough to search on? A blank or "Unknown Artist" tag can't match anything. */
export function isQueryable(q: LyricsQuery): boolean {
  return !!q.track && !!q.artist && !UNKNOWN.test(q.artist) && !UNKNOWN.test(q.track);
}

/**
 * Resolve lyrics for a track. Tries the exact endpoint first (most accurate: it
 * matches on album + duration), then falls back to a search.
 *
 * The exact call 404s whenever the duration is off by more than ~2s, which is
 * common, so ANY failure there falls through to the search rather than being
 * reported. A real transport failure then surfaces from the search attempt — so
 * callers still get a thrown error for "offline" and `null` for "no lyrics".
 */
export async function resolveLyrics(
  q: LyricsQuery,
  get: (url: string) => Promise<any>
): Promise<LyricsHit | null> {
  if (!isQueryable(q)) return null;

  if (q.album && q.duration) {
    try {
      const exact = parseLyricsRecord(
        await get(lrclibGetUrl({ artist: q.artist, track: q.track, album: q.album, duration: q.duration }))
      );
      if (exact) return exact;
    } catch {
      // 404 (duration drift) or a hiccup — the search below is the real attempt.
    }
  }

  const results = await get(lrclibSearchUrl({ artist: q.artist, track: q.track }));
  return pickBestLyrics(Array.isArray(results) ? results : [], q.duration);
}
