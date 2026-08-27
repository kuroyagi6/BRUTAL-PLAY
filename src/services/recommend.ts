// Pure recommendation resolver: URL builders + parsers + an orchestrator that
// sequences them through an INJECTED fetcher. No network, no React — see
// recommend.test.ts. HTTP happens in main (electron/httpGet.cjs), reusing the
// transport and the per-host throttle the artist-photo lookup already uses.
//
// TWO SOURCES, AND WHY.
//
// Tracks come from the iTunes Search API; adjacent artists come from Deezer.
// That split is not a preference, it is forced: DEEZER SERVES NO TRACK PAYLOADS
// IN SOME REGIONS. /artist/{id}/top, /artist/{id}/albums and even track search
// all answer `{"data":[],"total":N}` — a non-zero total with an empty array, so
// the catalogue is there and simply withheld. It fails silently rather than
// erroring, which is exactly how the first build of this feature shipped a
// report with 145 related artists and zero tracks. Deezer's /search/artist and
// /artist/{id}/related are NOT restricted, so the artist half still uses them.
//
// iTunes is keyless and has no such restriction, but Apple documents ~20 calls
// per minute and answers 403 past it — hence the 3.1s gap in httpGet.cjs, and
// why a scan is one iTunes request per artist rather than several.
//
// Last.fm would cover both halves but needs an API key: a signup step and a
// secret to store, for a feature that only ever produces a suggestion list.
//
// WHAT THIS DOES NOT DO: it never acquires audio. A suggestion carries a link
// back to its Deezer page (and, for the YouTube layer, a search URL) — deciding
// where a track comes from stays the user's call, exactly as the YouTube layer
// embeds rather than rips.
import type { Track } from '../types';
import { normalizeArtist } from '../utils/artistCredits';
import { DEEZER_HOST, deezerArtistSearchUrl, parseDeezerArtist } from './artistImage';

export { DEEZER_HOST };

export const ITUNES_HOST = 'itunes.apple.com';

/**
 * Cache/format version. Bump to invalidate every stored scan.
 * 2: tracks moved from Deezer (region-blocked, always empty) to iTunes.
 */
export const RADAR_VERSION = 2;

/**
 * An artist's tracks, most relevant first.
 *
 * `attribute=artistTerm` restricts the match to the ARTIST field — without it,
 * a search for "Nas" also matches every song with "nas" in its title. Results
 * are still verified against the wanted name in the parser, because artistTerm
 * matches loosely (a search for "Nirvana" returns "Nirvana UK" too).
 */
export function itunesArtistTracksUrl(artist: string, limit = 25): string {
  const q = new URLSearchParams({
    term: artist,
    entity: 'song',
    attribute: 'artistTerm',
    limit: String(limit),
  });
  return `https://${ITUNES_HOST}/search?${q}`;
}

/**
 * DEAD IN SOME REGIONS — kept only so the failure is documented in one place.
 * Deezer answers this with `{"data":[],"total":0}` for every artist in a
 * restricted region. Do not reintroduce it as the track source.
 */
export function deezerArtistTopUrl(id: number, limit = 25): string {
  return `https://${DEEZER_HOST}/artist/${id}/top?limit=${limit}`;
}

/** Artists Deezer considers adjacent to this one. Feeds the NEW ARTISTS list. */
export function deezerRelatedUrl(id: number, limit = 8): string {
  return `https://${DEEZER_HOST}/artist/${id}/related?limit=${limit}`;
}

/** One track the user's library does not appear to have. */
export interface SuggestedTrack {
  /** Stable across scans: "deezer:<trackId>". Used as a React key and dismiss id. */
  id: string;
  title: string;
  /** The artist as DEEZER credits it — may differ in case/punctuation from the tag. */
  artist: string;
  album?: string;
  coverUrl?: string;
  /** Deezer's page for this track. The row's primary action. */
  link?: string;
  /** 30s clip Deezer publishes publicly. Present on most tracks. */
  previewUrl?: string;
  duration?: number;
  /** Deezer popularity, used only for ordering. */
  rank: number;
}

/** An adjacent artist with no tracks in the library. */
export interface RelatedArtist {
  id: number;
  name: string;
  thumbUrl?: string;
  link?: string;
  fans: number;
  /** Which of the user's own artists suggested this one. */
  via: string;
}

/**
 * Reduce a title to something comparable across catalogues.
 *
 * This is the whole accuracy story of the feature: a suggestion the user already
 * owns is noise, and tagged libraries and Deezer disagree constantly about
 * parenthetical suffixes ("Song (Remastered 2011)" vs "Song"), feature credits
 * carried in the title, dashes, and punctuation. Strip all of it.
 *
 * Deliberately aggressive — a false "you already have this" merely omits one
 * suggestion, while a false "you're missing this" sends the user hunting for a
 * track already sitting in their library.
 */
export function normalizeTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics left by NFKD
    // Parenthetical/bracketed noise: features, remasters, versions, live takes.
    .replace(/[([{][^)\]}]*(feat|ft|with|remaster|remastered|version|edit|mix|live|mono|stereo|bonus|deluxe|explicit|anniversary)[^)\]}]*[)\]}]/g, ' ')
    // Trailing " - Remastered 2011", " - Radio Edit", " - Live at …".
    // \w* (not \b) so the stem also catches "remastered" / "remixed" / "edited".
    .replace(/\s-\s.*(remaster|version|edit|mix|live|mono|stereo|bonus|deluxe|take)\w*.*$/i, ' ')
    // A bare "feat. X" tail with no brackets.
    .replace(/\s(feat|ft|featuring)\.?\s.*$/i, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const pickTrack = (raw: any): SuggestedTrack | null => {
  const id = raw?.id;
  const title: string = raw?.title_short || raw?.title || '';
  if (!id || !title) return null;
  return {
    id: `deezer:${id}`,
    title,
    artist: raw?.artist?.name || '',
    album: raw?.album?.title || undefined,
    coverUrl: raw?.album?.cover_medium || raw?.album?.cover || undefined,
    link: raw?.link || undefined,
    previewUrl: raw?.preview || undefined,
    duration: typeof raw?.duration === 'number' ? raw.duration : undefined,
    rank: typeof raw?.rank === 'number' ? raw.rank : 0,
  };
};

/**
 * Parse a /artist/{id}/top payload.
 *
 * Deezer's top list can include tracks where the searched artist is only a
 * guest; `wanted` keeps the list about the artist actually asked for, so a scan
 * of one artist doesn't fill the report with a collaborator's catalogue.
 */
export function parseDeezerTopTracks(json: any, wanted: string): SuggestedTrack[] {
  const want = normalizeArtist(wanted);
  const out: SuggestedTrack[] = [];
  const seen = new Set<string>();
  for (const raw of json?.data ?? []) {
    const t = pickTrack(raw);
    if (!t) continue;
    if (want && t.artist && normalizeArtist(t.artist) !== want) continue;
    // Deezer lists the same song from several releases (album + single + best-of).
    const key = normalizeTitle(t.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => b.rank - a.rank);
}

/**
 * Parse an iTunes Search payload into suggestions.
 *
 * `wanted` is enforced here rather than trusted from the query: artistTerm
 * matches loosely, so a scan for "Nirvana" comes back with "Nirvana UK" tracks
 * too, and a suggestion under the wrong artist is worse than one fewer row.
 *
 * iTunes has no popularity field — results arrive in relevance order, so rank is
 * derived from position. That keeps `rank` meaningful for the cross-artist sort
 * in collateScans without pretending we know play counts.
 */
export function parseItunesTracks(json: any, wanted: string): SuggestedTrack[] {
  const want = normalizeArtist(wanted);
  const results: any[] = json?.results ?? [];
  const out: SuggestedTrack[] = [];
  const seen = new Set<string>();

  results.forEach((raw, i) => {
    if (raw?.kind && raw.kind !== 'song') return;
    const id = raw?.trackId;
    const title: string = raw?.trackName || '';
    const artist: string = raw?.artistName || '';
    if (!id || !title) return;
    if (want && artist && normalizeArtist(artist) !== want) return;

    // The same song appears once per release (album + single + deluxe).
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return;
    seen.add(key);

    // artworkUrl100 is a 100px square; the CDN serves any size at the same path.
    const art: string | undefined = raw.artworkUrl100 || raw.artworkUrl60 || undefined;

    out.push({
      id: `itunes:${id}`,
      title,
      artist,
      album: raw.collectionName || undefined,
      coverUrl: art ? art.replace(/\/\d+x\d+bb\./, '/200x200bb.') : undefined,
      link: raw.trackViewUrl || undefined,
      previewUrl: raw.previewUrl || undefined,
      duration: typeof raw.trackTimeMillis === 'number' ? Math.round(raw.trackTimeMillis / 1000) : undefined,
      // Relevance order, highest first, so it sorts alongside Deezer ranks.
      rank: Math.max(1, results.length - i),
    });
  });

  return out;
}

/** Parse a /artist/{id}/related payload. `via` records who suggested them. */
export function parseDeezerRelated(json: any, via: string): RelatedArtist[] {
  const out: RelatedArtist[] = [];
  for (const raw of json?.data ?? []) {
    if (!raw?.id || !raw?.name) continue;
    const pic: string | undefined = raw.picture_medium || raw.picture_small || undefined;
    out.push({
      id: raw.id,
      name: raw.name,
      // Deezer returns a URL with an empty artist hash when it has no photo.
      thumbUrl: pic && !/\/images\/artist\/\//.test(pic) ? pic : undefined,
      link: raw.link || undefined,
      fans: typeof raw.nb_fan === 'number' ? raw.nb_fan : 0,
      via,
    });
  }
  return out.sort((a, b) => b.fans - a.fans);
}

/**
 * Every normalized title the library holds for `artist`.
 *
 * Matched on the TRACK's own artist tag rather than a pre-split list, and
 * loosely: a track credited "Nas feat. Lauryn Hill" still counts as a Nas track
 * the user owns, so it can't come back as a suggestion.
 */
export function ownedTitles(tracks: Track[], artist: string): Set<string> {
  const want = normalizeArtist(artist);
  const out = new Set<string>();
  if (!want) return out;
  for (const t of tracks) {
    const credit = normalizeArtist(t.artist || '');
    if (!credit) continue;
    if (credit !== want && !credit.includes(want)) continue;
    const key = normalizeTitle(t.name || '');
    if (key) out.add(key);
  }
  return out;
}

/** Suggestions minus what the library already holds. */
export function missingTracks(suggestions: SuggestedTrack[], owned: Set<string>): SuggestedTrack[] {
  return suggestions.filter((s) => !owned.has(normalizeTitle(s.title)));
}

/** Artist names the library has at least one track for, normalized. */
export function ownedArtists(tracks: Track[]): Set<string> {
  const out = new Set<string>();
  for (const t of tracks) {
    const n = normalizeArtist(t.artist || '');
    if (n) out.add(n);
  }
  return out;
}

/** What one artist's scan produced. */
export interface ArtistScan {
  /** The library's spelling — what the UI groups under. */
  artist: string;
  /** Tracks Deezer has for this artist that the library appears to lack. */
  missing: SuggestedTrack[];
  /** Adjacent artists, not yet filtered against the library. */
  related: RelatedArtist[];
  /** True when Deezer had no exact match for the name (not an error). */
  notFound: boolean;
}

export type JsonGetter = (url: string) => Promise<any>;

/**
 * Scan one artist: pull their tracks from iTunes, their neighbours from Deezer,
 * and subtract what the library already has.
 *
 * THE TWO HALVES ARE INDEPENDENT ON PURPOSE. They are different services with
 * different failure modes, and the first build coupled them — the Deezer artist
 * lookup gated everything, so in a region where Deezer withholds tracks the
 * report came back with plenty of related artists and not one track. Now a
 * failure on either side costs only that side's rows.
 *
 * `notFound` means NEITHER source knew the artist — the honest signal for a
 * local band or a misspelled tag. A scan of 200 artists must never abort
 * because one of them is unknown, so only a total transport failure throws.
 */
export async function scanArtist(
  artist: string,
  tracks: Track[],
  get: JsonGetter,
  opts: { topLimit?: number; relatedLimit?: number } = {}
): Promise<ArtistScan> {
  // TRACKS (iTunes) — the half the user is actually here for.
  let top: SuggestedTrack[] = [];
  let tracksFailed = false;
  try {
    top = parseItunesTracks(
      await get(itunesArtistTracksUrl(artist, opts.topLimit ?? 25)),
      artist
    );
  } catch {
    tracksFailed = true;
  }

  // RELATED ARTISTS (Deezer) — best effort. Two requests: resolve, then browse.
  let related: RelatedArtist[] = [];
  let artistFailed = false;
  try {
    const hit = parseDeezerArtist(await get(deezerArtistSearchUrl(artist)), artist);
    if (hit) {
      related = parseDeezerRelated(
        await get(deezerRelatedUrl(hit.id, opts.relatedLimit ?? 8)),
        artist
      );
    } else {
      artistFailed = true;
    }
  } catch {
    artistFailed = true;
  }

  // Both sources failed outright — the caller should surface that, not silently
  // report "nothing missing".
  if (tracksFailed && artistFailed) {
    throw new Error(`lookup failed for ${artist}`);
  }

  return {
    artist,
    missing: missingTracks(top, ownedTitles(tracks, artist)),
    related,
    notFound: top.length === 0 && related.length === 0,
  };
}

/**
 * Fold per-artist scans into the two lists the UI shows.
 *
 * Related artists are deduped and filtered against the library here rather than
 * during the scan: an artist suggested by three of your artists is one row with
 * the strongest recommendation, not three rows.
 */
export function collateScans(
  scans: ArtistScan[],
  tracks: Track[]
): { tracks: SuggestedTrack[]; artists: RelatedArtist[] } {
  const owned = ownedArtists(tracks);

  const seenTrack = new Set<string>();
  const outTracks: SuggestedTrack[] = [];
  for (const s of scans) {
    for (const t of s.missing) {
      if (seenTrack.has(t.id)) continue;
      seenTrack.add(t.id);
      outTracks.push(t);
    }
  }

  const byArtist = new Map<string, RelatedArtist>();
  for (const s of scans) {
    for (const r of s.related) {
      const key = normalizeArtist(r.name);
      if (!key || owned.has(key)) continue; // already in the library — not news
      const prev = byArtist.get(key);
      if (!prev || r.fans > prev.fans) byArtist.set(key, r);
    }
  }

  return {
    tracks: outTracks.sort((a, b) => b.rank - a.rank),
    artists: [...byArtist.values()].sort((a, b) => b.fans - a.fans),
  };
}

/**
 * The artists worth scanning, most-represented first.
 *
 * A library's long tail is mostly one-off tracks and mistagged rows; scanning
 * them burns requests to suggest music for an "artist" the user barely has. The
 * artists with the most tracks are the ones they actually listen to.
 */
export function scanCandidates(tracks: Track[], limit = 40): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const t of tracks) {
    const raw = (t.artist || '').trim();
    const key = normalizeArtist(raw);
    if (!key || /^(unknown|various)/i.test(raw)) continue;
    const prev = counts.get(key);
    if (prev) prev.n++;
    else counts.set(key, { name: raw, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => c.name);
}

/** A YouTube search for a suggestion — the handoff to the existing embed layer. */
export function youtubeSearchUrl(t: SuggestedTrack): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.artist} ${t.title}`)}`;
}
