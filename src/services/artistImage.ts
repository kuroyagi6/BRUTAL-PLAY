// Pure Deezer artist-image resolver. URL builder + parser only — the HTTP goes
// through main (electron/httpGet.cjs), same as the MusicBrainz chain. Deezer is
// the PRIMARY photo source because Wikipedia's page-image coverage is thin: most
// artists have no page image (or no page), which is why artist rows showed no
// picture at all. Wikipedia stays the fallback, and still supplies bio + tags.
//
// Keyless: api.deezer.com/search/artist needs no token.
import { normalizeArtist } from '../utils/artistCredits';

export const DEEZER_HOST = 'api.deezer.com';

/**
 * Search wide, not narrow. Deezer's relevance ordering is unreliable for short
 * names — `q=Nas` returns "Nas & The Game" (117 fans) first and the real Nas
 * (1.2M fans) only at position 5 — so we fetch a page and pick ourselves.
 */
export function deezerArtistSearchUrl(name: string): string {
  return `https://${DEEZER_HOST}/search/artist?q=${encodeURIComponent(name)}&limit=10`;
}

export interface DeezerArtist {
  id: number;
  name: string;
  /** 500x500 — the ARTIST tab hero. */
  imageUrl?: string;
  /** 250x250 — the Spotlight/list avatar. Don't pull 500px for a 32px row. */
  thumbUrl?: string;
  /** Popularity, used only to break ties between exact name matches. */
  fans: number;
  link?: string;
}

/**
 * Deezer always returns a picture URL, even when it has no photo: the artist
 * hash in the path is simply empty (".../images/artist//500x500-000000-80-0-0.jpg").
 * Treat those as "no image" rather than caching a blank square.
 */
export function isPlaceholderImage(url: string | undefined): boolean {
  if (!url) return true;
  return /\/images\/artist\/\/|\/images\/artist\/$/.test(url);
}

const pick = (raw: any): DeezerArtist => {
  const big: string | undefined = raw?.picture_big || raw?.picture_xl || undefined;
  const med: string | undefined = raw?.picture_medium || raw?.picture_small || undefined;
  return {
    id: raw?.id,
    name: raw?.name || '',
    imageUrl: isPlaceholderImage(big) ? undefined : big,
    thumbUrl: isPlaceholderImage(med) ? undefined : med,
    fans: typeof raw?.nb_fan === 'number' ? raw.nb_fan : 0,
    link: raw?.link || undefined,
  };
};

/**
 * Choose the artist that IS `wanted`, or nothing.
 *
 * Deliberately strict: only an exact normalized-name match counts, so a search
 * for "Nas" can never settle for "N.A.S" or "Nas & The Game". A missing photo is
 * a non-event; the wrong face attached to an artist is a bug the user sees and
 * can't explain. Among exact matches, the most-followed wins (that is the real
 * "Nas", not a same-named bootleg act).
 */
export function parseDeezerArtist(json: any, wanted: string): DeezerArtist | null {
  const want = normalizeArtist(wanted);
  if (!want) return null;

  const exact = (json?.data ?? [])
    .map(pick)
    .filter((a: DeezerArtist) => a.id && normalizeArtist(a.name) === want)
    .sort((a: DeezerArtist, b: DeezerArtist) => b.fans - a.fans);

  return exact[0] ?? null;
}

export interface ArtistImage {
  imageUrl?: string;
  thumbUrl?: string;
  /** Attribution link back to the Deezer artist page. */
  link?: string;
}

/**
 * Resolve just the photo for an artist name. Never throws for "not found" —
 * returns null so the caller can fall back to Wikipedia's page image. A
 * transport error DOES propagate, so the caller can tell "offline" from "no
 * photo exists".
 */
export async function resolveArtistImage(
  name: string,
  get: (url: string) => Promise<any>
): Promise<ArtistImage | null> {
  const hit = parseDeezerArtist(await get(deezerArtistSearchUrl(name)), name);
  if (!hit || (!hit.imageUrl && !hit.thumbUrl)) return null;
  return { imageUrl: hit.imageUrl, thumbUrl: hit.thumbUrl, link: hit.link };
}
