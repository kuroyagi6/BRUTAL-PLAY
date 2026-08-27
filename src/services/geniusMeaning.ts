// Pure Genius annotation resolver: URL builders + parsers + a matcher that maps
// crowd-sourced meanings onto the lines of a synced lyric. No network, no React
// — testable with a fake getter (see geniusMeaning.test.ts). HTTP happens in
// main (electron/httpGet.cjs), which attaches the bearer token.
//
// WHY GENIUS IS HERE BUT NOT IN lyricsFetch.ts: Genius has no timestamped
// lyrics, and its API deliberately withholds lyric TEXT — getting the words
// means scraping the page, which its terms forbid. That is still true, and
// LRCLIB remains the only lyrics source. But /referents is a documented, public
// endpoint that returns each annotated FRAGMENT together with its annotation
// body. Matching those fragments back onto the lines LRCLIB already gave us
// yields a per-line meaning without fetching a single line of lyrics from
// Genius, and without scraping anything.
//
// Requires the user's own free Client Access Token (genius.com/api-clients) —
// same bring-your-own-credential shape as the Google Drive layer.

export const GENIUS_HOST = 'api.genius.com';

/** One annotated fragment of a song. */
export interface Annotation {
  /** The lyric excerpt this annotation is attached to. May span several lines. */
  fragment: string;
  /** The annotation text, plain (we request text_format=plain). */
  body: string;
  /** Permalink to the annotation on genius.com, for "read on Genius". */
  url?: string;
  /** Community score — used to pick between competing annotations. */
  votes: number;
}

/** The Genius song a set of annotations belongs to. */
export interface GeniusSong {
  id: number;
  title: string;
  artist: string;
  url: string;
}

export interface SongQuery {
  artist: string;
  track: string;
}

/** Genius returns 50 referents per page at most. */
export const PER_PAGE = 50;
/** Ceiling on paging: 4 pages is ~200 annotations, more than any real song. */
export const MAX_PAGES = 4;

export function geniusSearchUrl(q: SongQuery): string {
  const p = new URLSearchParams({ q: `${q.artist} ${q.track}`.trim() });
  return `https://${GENIUS_HOST}/search?${p}`;
}

export function geniusReferentsUrl(songId: number, page = 1): string {
  const p = new URLSearchParams({
    song_id: String(songId),
    text_format: 'plain',
    per_page: String(PER_PAGE),
    page: String(page),
  });
  return `https://${GENIUS_HOST}/referents?${p}`;
}

/**
 * Fold a lyric line (or a Genius fragment) to its comparable form. Section
 * markers like "[Chorus]" are dropped: Genius fragments carry them, LRC lines
 * generally don't, and left in they'd match every chorus line at once.
 */
export function normalizeFragment(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[‘’ʼ']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSearchHits(raw: any): GeniusSong[] {
  const hits = raw?.response?.hits;
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h: any) => h?.type === 'song' && h?.result?.id)
    .map((h: any) => ({
      id: h.result.id,
      title: String(h.result.title ?? ''),
      artist: String(h.result.primary_artist?.name ?? ''),
      url: String(h.result.url ?? ''),
    }));
}

/**
 * Pick the song these lyrics belong to.
 *
 * Genius ranks its own search well, so hit order is the tiebreak — but it
 * happily returns covers, remixes and "(Live)" takes above the original, and an
 * annotation set from the wrong recording lands meanings on the wrong lines.
 * So the title has to actually match, and the artist agreeing outweighs rank.
 */
export function pickBestSong(hits: GeniusSong[], q: SongQuery): GeniusSong | null {
  const wantTitle = normalizeFragment(q.track);
  const wantArtist = normalizeFragment(q.artist);
  if (!wantTitle) return null;

  let best: GeniusSong | null = null;
  let bestScore = -Infinity;

  hits.forEach((h, rank) => {
    const title = normalizeFragment(h.title);
    const artist = normalizeFragment(h.artist);

    let score: number;
    if (title === wantTitle) score = 100;
    else if (title.includes(wantTitle) || wantTitle.includes(title)) score = 60;
    else return; // a different song entirely

    if (wantArtist) {
      if (artist === wantArtist) score += 50;
      else if (artist.includes(wantArtist) || wantArtist.includes(artist)) score += 30;
      else score -= 40; // same title, someone else's record
    }
    score -= rank; // Genius' own ranking, as the last word

    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  });

  return bestScore > 0 ? best : null;
}

export function parseReferents(raw: any): Annotation[] {
  const refs = raw?.response?.referents;
  if (!Array.isArray(refs)) return [];
  const out: Annotation[] = [];

  for (const r of refs) {
    const fragment = String(r?.fragment ?? '').trim();
    if (!fragment) continue;
    const anns = Array.isArray(r?.annotations) ? r.annotations : [];
    // A fragment can carry several competing annotations; the community's
    // top-voted one is the one Genius itself shows first.
    const best = anns
      .slice()
      .sort((a: any, b: any) => (b?.votes_total ?? 0) - (a?.votes_total ?? 0))[0];
    const body = String(best?.body?.plain ?? '').trim();
    if (!body) continue;
    out.push({
      fragment,
      body,
      url: best?.url ? String(best.url) : undefined,
      votes: typeof best?.votes_total === 'number' ? best.votes_total : 0,
    });
  }
  return out;
}

/** Below this many characters a fragment line ("oh", "yeah") matches anywhere. */
const MIN_FRAGMENT_LEN = 6;
/** A partial match must cover this share of the longer string to count. */
const MIN_OVERLAP = 0.5;

/** Best lyric line for one normalized fragment line, or -1. */
function findLine(normLines: string[], frag: string, from: number): number {
  let best = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < normLines.length; i++) {
    const line = normLines[i];
    if (!line) continue;

    let score: number;
    if (line === frag) {
      score = 100;
    } else if (line.includes(frag) || frag.includes(line)) {
      const ratio = Math.min(line.length, frag.length) / Math.max(line.length, frag.length);
      if (ratio < MIN_OVERLAP) continue;
      score = 60 * ratio;
    } else {
      continue;
    }

    // Annotations arrive in song order, so a match at or after the previous one
    // is the likelier reading of a repeated chorus line.
    score += i >= from ? 10 - Math.min(9, (i - from) * 0.05) : -5;

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Map annotations onto lyric lines: result[i] is the annotation covering line i,
 * or null. A fragment spanning several lines annotates each of them, so holding
 * on a line mid-fragment still shows its meaning.
 */
export function matchAnnotations(lines: string[], annotations: Annotation[]): (Annotation | null)[] {
  const norm = lines.map(normalizeFragment);
  const out: (Annotation | null)[] = lines.map(() => null);
  let cursor = 0;

  for (const a of annotations) {
    const fragLines = a.fragment
      .split('\n')
      .map(normalizeFragment)
      .filter((l) => l.length >= MIN_FRAGMENT_LEN);
    if (!fragLines.length) continue;

    let first = -1;
    for (const f of fragLines) {
      const i = findLine(norm, f, cursor);
      if (i < 0) continue;
      if (first < 0) first = i;
      // First annotation to claim a line keeps it — earlier ones are the
      // better-ranked fragments for that spot.
      if (!out[i]) out[i] = a;
    }
    if (first >= 0) cursor = first;
  }
  return out;
}

export interface SongAnnotations {
  song: GeniusSong;
  annotations: Annotation[];
}

/**
 * Resolver version stamped onto every cached row. Bump it when the matching or
 * parsing changes in a way that would make an old row wrong — rows below the
 * current version are treated as a cache MISS rather than as truth, the same
 * rule artist profiles use (services/artistProfile#PROFILE_VERSION).
 */
export const MEANINGS_VERSION = 1;

/** A cached lookup, as stored in IndexedDB. */
export interface StoredMeanings {
  /** `meaningsKey(query)` — stable across re-imports and duplicate files. */
  key: string;
  song: GeniusSong | null;
  annotations: Annotation[];
  /** True when Genius simply has nothing for this song. Cached so an offline
   *  session doesn't retry it every time the track comes round. */
  notFound: boolean;
  fetchedAt: number;
  v: number;
}

/**
 * Cache key for a song. Deliberately NOT the track id: re-importing the same
 * file mints a new id, and two copies of a song shouldn't cost two lookups.
 * Normalized, so "Don't Stop" and "Dont Stop!" share one row.
 */
export function meaningsKey(q: SongQuery): string {
  return `${normalizeFragment(q.artist)}|${normalizeFragment(q.track)}`;
}

const UNKNOWN = /^(unknown|various)/i;

/** Enough tags to identify the song on Genius? */
export function isQueryable(q: SongQuery): boolean {
  return !!q.track.trim() && !!q.artist.trim() && !UNKNOWN.test(q.artist) && !UNKNOWN.test(q.track);
}

/**
 * Find the song, then pull every annotation on it.
 *
 * Returns null when Genius has no confident match for the song — distinct from
 * a throw, which means the request itself failed (offline, or a bad token).
 */
export async function resolveSongAnnotations(
  q: SongQuery,
  get: (url: string) => Promise<any>
): Promise<SongAnnotations | null> {
  if (!isQueryable(q)) return null;

  const song = pickBestSong(parseSearchHits(await get(geniusSearchUrl(q))), q);
  if (!song) return null;

  const annotations: Annotation[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await get(geniusReferentsUrl(song.id, page));
    const refs = raw?.response?.referents;
    const batch = parseReferents(raw);
    annotations.push(...batch);
    // Page on the RAW count, not the parsed one: a page of referents that all
    // lack annotation bodies parses to zero yet still has a next page.
    if (!Array.isArray(refs) || refs.length < PER_PAGE) break;
  }

  return { song, annotations };
}
