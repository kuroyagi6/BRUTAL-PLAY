// Pure artist-profile resolver. Builds the query URLs and parses the JSON for a
// MusicBrainz -> Wikipedia lookup, plus a small orchestrator that sequences them
// through an INJECTED fetcher. No network and no React live here, so the whole
// flow is unit-testable with a fake fetcher (see artistProfile.test.ts). The
// actual HTTP happens in main (electron/main.cjs `http-get-json`), because
// MusicBrainz rejects requests without a real User-Agent, which the renderer
// cannot set.
import type { ArtistProfile } from '../types';
import { resolveArtistImage, type ArtistImage } from './artistImage';

/**
 * Hosts the online-profile feature is allowed to contact. Main enforces this too
 * (defence in depth); duplicated here so the pure layer never builds a URL that
 * main would reject. Keep these two lists in sync.
 */
export const ALLOWED_HOSTS = [
  'musicbrainz.org',
  'en.wikipedia.org',
  'www.wikidata.org',
  'api.deezer.com',
  'lrclib.net',
  // RADAR's track source (services/recommend.ts).
  'itunes.apple.com',
  // Lyric ANNOTATIONS for the MEANING corner (services/geniusMeaning.ts). The
  // only host requiring a credential; main attaches the user's own token.
  'api.genius.com',
] as const;

/** A fetcher that returns parsed JSON for a URL, or throws. Injected so tests
 *  and the renderer can supply their own transport. */
export type JsonGetter = (url: string) => Promise<any>;

// --- MusicBrainz: find the artist and its external links ---------------------

export function mbArtistSearchUrl(name: string): string {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  return `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=1`;
}

export interface MbArtist {
  mbid: string;
  name: string;
  disambiguation?: string;
  country?: string;
}

export function parseMbArtist(json: any): MbArtist | null {
  const a = json?.artists?.[0];
  if (!a?.id) return null;
  return {
    mbid: a.id,
    name: a.name || '',
    disambiguation: a.disambiguation || undefined,
    country: a.country || undefined,
  };
}

export function mbArtistRelationsUrl(mbid: string): string {
  return `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels+tags&fmt=json`;
}

export interface MbRelations {
  wikipediaUrl?: string;
  wikidataUrl?: string;
  tags: string[];
}

export function parseRelations(json: any): MbRelations {
  const out: MbRelations = { tags: [] };
  for (const rel of json?.relations ?? []) {
    const resource: string | undefined = rel?.url?.resource;
    if (!resource) continue;
    if (rel.type === 'wikipedia' && !out.wikipediaUrl) out.wikipediaUrl = resource;
    if (rel.type === 'wikidata' && !out.wikidataUrl) out.wikidataUrl = resource;
  }
  // Tags come back with counts; keep the most-used first, drop zero/negative.
  const tags = (json?.tags ?? [])
    .filter((t: any) => (t?.count ?? 0) > 0 && t?.name)
    .sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))
    .map((t: any) => t.name as string);
  out.tags = tags.slice(0, 6);
  return out;
}

// --- Wikipedia / Wikidata: bio + image ---------------------------------------

export interface WikiTitle {
  lang: string;
  title: string;
}

/** Pull the language + page title out of a Wikipedia article URL. */
export function wikipediaTitleFromUrl(url: string): WikiTitle | null {
  const m = url.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  return { lang: m[1], title: decodeURIComponent(m[2]) };
}

/** REST summary endpoint — returns an extract plus a page image. We only reach
 *  for the English endpoint (allowlisted); non-en links fall back to Wikidata. */
export function wikipediaSummaryUrl(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
}

export interface WikiSummary {
  bio?: string;
  imageUrl?: string;
}

export function parseWikipediaSummary(json: any): WikiSummary {
  return {
    bio: json?.extract || undefined,
    imageUrl: json?.originalimage?.source || json?.thumbnail?.source || undefined,
  };
}

/** Extract the Q-id from a Wikidata entity URL. */
export function wikidataIdFromUrl(url: string): string | null {
  const m = url.match(/\/(Q\d+)(?:$|[/?#])/);
  return m ? m[1] : null;
}

export function wikidataEntityUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
}

/** Read the English Wikipedia article title from a Wikidata entity's sitelinks. */
export function parseWikidataEnwikiTitle(json: any, qid: string): string | null {
  return json?.entities?.[qid]?.sitelinks?.enwiki?.title || null;
}

// --- Orchestration -----------------------------------------------------------

/**
 * Bump when the resolver learns to find something it previously couldn't, so
 * profiles cached by an older build are treated as stale instead of as truth.
 *
 * v2 added the Deezer photo step. Without this, every artist looked up under v1
 * would keep showing no picture forever — the cache would happily serve back the
 * image-less (or `notFound`) row that the old Wikipedia-only chain wrote.
 */
export const PROFILE_VERSION = 2;

/**
 * Resolve a full profile for an artist name by sequencing the calls above
 * through `get`. Returns a profile with whatever could be found (never throws
 * for "not found" — returns a `notFound` stub so the caller can cache it), or
 * propagates a transport error so the caller can distinguish "offline" from
 * "no such artist".
 */
export async function resolveArtistProfile(
  name: string,
  get: JsonGetter
): Promise<ArtistProfile> {
  const key = name.trim().toLowerCase();
  const base: ArtistProfile = { key, name, sources: [], fetchedAt: Date.now(), v: PROFILE_VERSION };

  // Photo first, from Deezer: one request, and it covers artists MusicBrainz and
  // Wikipedia have nothing usable for. Best-effort — a photo is never worth
  // sinking the bio, so a failure here just leaves `image` null.
  let image: ArtistImage | null = null;
  try {
    image = await resolveArtistImage(name, get);
  } catch {
    /* Deezer down / rate-limited — fall through to the Wikipedia page image. */
  }

  const deezerSource = image?.link ? [{ label: 'Deezer', url: image.link }] : [];

  const artist = parseMbArtist(await get(mbArtistSearchUrl(name)));
  if (!artist) {
    // MusicBrainz doesn't know this name — but if Deezer had a photo, this is a
    // partial hit, not a miss. Only a profile with NOTHING in it is `notFound`.
    if (!image) return { ...base, notFound: true };
    return { ...base, imageUrl: image.imageUrl, thumbUrl: image.thumbUrl, sources: deezerSource };
  }

  const profile: ArtistProfile = {
    ...base,
    name: artist.name || name,
    mbid: artist.mbid,
    disambiguation: artist.disambiguation,
    country: artist.country,
    imageUrl: image?.imageUrl,
    thumbUrl: image?.thumbUrl,
    sources: [
      { label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${artist.mbid}` },
      ...deezerSource,
    ],
  };

  const rels = parseRelations(await get(mbArtistRelationsUrl(artist.mbid)));
  if (rels.tags.length) profile.tags = rels.tags;

  // Find an English Wikipedia title, either directly or via Wikidata.
  let enTitle: string | null = null;
  if (rels.wikipediaUrl) {
    const wt = wikipediaTitleFromUrl(rels.wikipediaUrl);
    if (wt?.lang === 'en') enTitle = wt.title;
  }
  if (!enTitle && rels.wikidataUrl) {
    const qid = wikidataIdFromUrl(rels.wikidataUrl);
    if (qid) {
      try {
        enTitle = parseWikidataEnwikiTitle(await get(wikidataEntityUrl(qid)), qid);
      } catch {
        // Wikidata is best-effort; a failure here still leaves the MB profile.
      }
    }
  }

  if (enTitle) {
    try {
      const summary = parseWikipediaSummary(await get(wikipediaSummaryUrl(enTitle)));
      if (summary.bio) profile.bio = summary.bio;
      // Wikipedia is the FALLBACK photo: only reach for its page image when
      // Deezer had none. Deezer ships a real press photo at a predictable crop;
      // a Wikipedia page image can be a live shot, a logo, or a signature.
      if (summary.imageUrl && !profile.imageUrl) profile.imageUrl = summary.imageUrl;
      profile.sources.push({
        label: 'Wikipedia',
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(enTitle)}`,
      });
    } catch {
      // Same: a Wikipedia hiccup shouldn't sink the MusicBrainz result.
    }
  }

  return profile;
}
