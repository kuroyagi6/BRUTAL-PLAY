// Pure library-wide lyric search: turn every track's stored lyrics into lines,
// then find a phrase across all of them. No network, no React, no IDB — the
// whole thing is a function of the tracks array the player already holds, so it
// is unit-testable (see lyricsSearch.test.ts) and costs nothing until typed in.
//
// Scope note: this searches what is ALREADY on disk. It is deliberately not an
// online "name that tune" search — LRCLIB's search matches title/artist/album
// rather than lyric bodies, and Genius will not return lyric text at all, so
// there is no honest online phrase search to offer. Fetch lyrics first (Lyrics
// window / AUTO_FETCH), and they become searchable here.
import type { Track } from '../types';

/** One line of a track's lyrics, with its timestamp when the track is synced. */
export interface LyricLine {
  text: string;
  /** Seconds into the track. Absent for plain (untimed) lyrics. */
  timestamp?: number;
}

/** A matching line, with enough context to render and to jump to. */
export interface LyricHit {
  trackId: string;
  trackName: string;
  artist: string;
  lineIndex: number;
  text: string;
  timestamp?: number;
  /** The line before/after, for context in the result row. */
  before?: string;
  after?: string;
  /** Where the query matched inside `text`, for highlighting. -1 = whole line. */
  matchStart: number;
  matchEnd: number;
}

export interface SearchOptions {
  /** Cap on total hits returned. */
  limit?: number;
  /** Cap on hits from any one track, so a chorus can't flood the list. */
  perTrack?: number;
}

/**
 * Punctuation/case-insensitive form, used only for the FALLBACK match — it
 * changes string length, so it can't give highlight offsets. The primary match
 * is a plain lowercase substring, which keeps indices valid.
 */
export function normalizeLyricText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '') // don't == dont
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A track's lyrics as lines. Synced lyrics win when present — they carry the
 * timestamps that make a hit clickable. Blank lines are kept so `lineIndex`
 * stays aligned with what the Lyrics view renders.
 */
export function trackLyricLines(t: Track): LyricLine[] {
  if (t.syncedLyrics && t.syncedLyrics.length > 0) {
    return t.syncedLyrics.map((l) => ({ text: l.text, timestamp: l.timestamp }));
  }
  if (t.lyrics) return t.lyrics.split('\n').map((text) => ({ text }));
  return [];
}

/** How many tracks in the library have any lyrics at all — i.e. the index size. */
export function countIndexedTracks(tracks: Track[]): number {
  let n = 0;
  for (const t of tracks) {
    if ((t.syncedLyrics && t.syncedLyrics.length > 0) || t.lyrics) n++;
  }
  return n;
}

/** Tracks with no lyrics stored, in library order — the batch-fetch worklist. */
export function tracksMissingLyrics(tracks: Track[]): Track[] {
  return tracks.filter((t) => !(t.syncedLyrics && t.syncedLyrics.length > 0) && !t.lyrics);
}

const MIN_QUERY = 2;

/**
 * Every line across the library containing `query`.
 *
 * Ranked so the most literal matches surface first: a line that starts with the
 * phrase beats one that merely contains it, and an exact-substring match beats a
 * punctuation-insensitive one. Ties fall back to track then line order, which
 * keeps the list stable as the user keeps typing.
 */
export function searchLyrics(
  tracks: Track[],
  query: string,
  opts: SearchOptions = {}
): LyricHit[] {
  const q = (query || '').trim();
  if (q.length < MIN_QUERY) return [];
  const limit = opts.limit ?? 200;
  const perTrack = opts.perTrack ?? 4;

  const qLower = q.toLowerCase();
  const qNorm = normalizeLyricText(q);

  const scored: { hit: LyricHit; score: number }[] = [];

  for (const t of tracks) {
    const lines = trackLyricLines(t);
    if (!lines.length) continue;
    let taken = 0;

    for (let i = 0; i < lines.length && taken < perTrack; i++) {
      const text = lines[i].text || '';
      if (!text.trim()) continue;

      let start = text.toLowerCase().indexOf(qLower);
      let score: number;

      if (start >= 0) {
        // Exact substring: strongest, and gives real highlight offsets.
        score = 100 - Math.min(50, start) + (start === 0 ? 20 : 0);
      } else if (qNorm && normalizeLyricText(text).includes(qNorm)) {
        // Same words, different punctuation ("dont" vs "don't"). Highlight the
        // whole line rather than guess at offsets in a re-written string.
        start = -1;
        score = 40;
      } else {
        continue;
      }

      scored.push({
        score,
        hit: {
          trackId: t.id,
          trackName: t.name,
          artist: t.artist,
          lineIndex: i,
          text,
          timestamp: lines[i].timestamp,
          before: lines[i - 1]?.text || undefined,
          after: lines[i + 1]?.text || undefined,
          matchStart: start,
          matchEnd: start >= 0 ? start + q.length : -1,
        },
      });
      taken++;
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.hit);
}
