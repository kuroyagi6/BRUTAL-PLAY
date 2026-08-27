// Pure artist-credit parsing. One `artist` tag often carries several real
// artists ("Jay-Z feat. Kanye West", "Calvin Harris & Dua Lipa"), and we want a
// profile per credited artist. No React, no network, no DOM — see
// artistCredits.test.ts.
//
// The hard part is NOT splitting; it is NOT splitting when you shouldn't. Plenty
// of single artists have a separator inside their name ("Earth, Wind & Fire",
// "Tyler, The Creator", "AC/DC"), so this errs toward leaving a tag whole. A
// missed split shows one chip instead of two; a wrong split invents artists that
// do not exist and sends junk names to a third-party API.

/** The artists credited on one track, in credit order. */
export interface ArtistCredits {
  /** The tag exactly as it appeared — always the display/grouping key. */
  raw: string;
  /** Main credited artist(s) — the part before any "feat." marker. */
  primary: string[];
  /** Artists introduced by a feature marker ("feat.", "ft.", "featuring"). */
  featured: string[];
  /** primary + featured, deduped, in credit order. The chip list. */
  all: string[];
}

/**
 * Single artists whose own name contains a weak separator. Matched against the
 * WHOLE normalized tag, so "Earth, Wind & Fire feat. Nas" still splits at the
 * feature marker and keeps "Earth, Wind & Fire" intact as the primary.
 * Not exhaustive by design — the `& The …` rule below catches the general
 * "frontman & backing band" shape, and this list covers the rest.
 */
const NEVER_SPLIT = new Set([
  'earth, wind & fire',
  'crosby, stills & nash',
  'crosby, stills, nash & young',
  'blood, sweat & tears',
  'emerson, lake & palmer',
  'peter, paul and mary',
  'tyler, the creator',
  'simon & garfunkel',
  'hall & oates',
  'daryl hall & john oates',
  'kool & the gang',
  'mumford & sons',
  'macklemore & ryan lewis',
  'angus & julia stone',
  'sam & dave',
  'ike & tina turner',
  'above & beyond',
  'sly & the family stone',
  'derek & the dominos',
  'florence + the machine',
  'me first & the gimme gimmes',
  'now, now',
  'panic! at the disco',
  'ac/dc',
]);

/**
 * Feature markers, longest-first so "featuring" wins over "feat". The `\b` sits
 * before the optional dot, not after it: `feat\.?\b` would backtrack to "feat"
 * (there's no word boundary between "." and " ") and leave the dot on the name.
 */
const FEATURE = /\s*[([]?\s*\b(?:featuring|feat|ft)\b\.?\s*/i;

/**
 * Separators that are safe to split on unconditionally — no real artist name
 * contains these in this form. ID3v2.4 packs multiple values with a NUL; a
 * slash or "vs" only counts when it is spaced, so "AC/DC" survives.
 */
const STRONG = /\0|\s*;\s*|\s+\/\s+|\s+vs\.?\s+|\s+x\s+/i;

/** Separators that are often part of a single artist's name. Guarded below. */
const WEAK = /\s*&\s*|\s*,\s*|\s+and\s+|\s*\+\s*/i;

/** Lowercase, strip diacritics + punctuation, collapse spaces. */
export function normalizeArtist(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const clean = (s: string) => s.replace(/[)\]]+\s*$/, '').trim();

/**
 * Would splitting `segment` on a weak separator invent artists that don't exist?
 * Rejects the known one-artist names, the "X & The Band" shape, absurd counts,
 * and any piece too short/long to be a real name.
 */
function weakSplitIsSafe(segment: string, parts: string[]): boolean {
  if (NEVER_SPLIT.has(segment.trim().toLowerCase())) return false;
  if (parts.length < 2 || parts.length > 4) return false;
  // "Nick Cave & The Bad Seeds", "Tyler, The Creator" — a piece that opens with
  // "the" is a backing band or an epithet, not a separate credit.
  if (parts.some((p, i) => i > 0 && /^the\b/i.test(p))) return false;
  return parts.every((p) => p.length >= 2 && p.length <= 40);
}

/** Split one segment into individual artists, applying the weak-separator guard. */
function splitSegment(segment: string): string[] {
  const strong = segment.split(STRONG).map(clean).filter(Boolean);
  return strong.flatMap((piece) => {
    const parts = piece.split(WEAK).map(clean).filter(Boolean);
    return weakSplitIsSafe(piece, parts) ? parts : [piece];
  });
}

/**
 * Parse an `artist` tag into its credited artists. Always returns at least one
 * entry (the raw tag) so callers never have to handle an empty credit list.
 */
export function parseArtistCredits(raw: string): ArtistCredits {
  const tag = (raw || '').trim();
  if (!tag) return { raw, primary: [], featured: [], all: [] };

  const [head, ...tail] = tag.split(FEATURE);
  const primary = splitSegment(clean(head));
  const featured = tail.flatMap((t) => splitSegment(clean(t)));

  // Dedupe case-insensitively but keep the first spelling seen.
  const seen = new Set<string>();
  const all = [...primary, ...featured].filter((n) => {
    const k = normalizeArtist(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { raw: tag, primary, featured, all: all.length ? all : [tag] };
}

/** Just the credited artist names — the common case. */
export function splitArtists(raw: string): string[] {
  return parseArtistCredits(raw).all;
}

/** Tags a lookup can't do anything with. */
const UNLOOKUPABLE = /^(unknown|various)/i;

/**
 * Every distinct real artist across a set of tracks, in first-seen order, with
 * featured artists pulled out of their tags and near-duplicates collapsed
 * ("JAY-Z" and "Jay Z" are one lookup, not two). This is the prefetch work list,
 * so the dedupe is what keeps a 2,000-track library from becoming 2,000
 * requests. Structural param — no dependency on the Track type.
 */
export function collectArtists(tracks: { artist?: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    for (const name of splitArtists(t.artist || '')) {
      if (UNLOOKUPABLE.test(name)) continue;
      const k = normalizeArtist(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
  }
  return out;
}
