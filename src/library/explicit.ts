// The one place that decides whether a track is explicit, how to detect that on
// import, and how the library's rating filter separates the two. Pure — no React,
// no DOM, no music-metadata coupling — so the metadata layer, the views, and a
// tiny test all agree on the same rule.

import type { Track } from '../types';

/**
 * The rating filter offered on any track list. `ALL` shows everything; the other
 * two split the list into explicit and non-explicit (clean). `mode.<VALUE>` i18n
 * keys label these, matching the sort/view menus.
 */
export type RatingFilter = 'ALL' | 'EXPLICIT' | 'CLEAN';

/** Every filter, in menu order. The filter UI iterates this instead of re-listing. */
export const RATING_FILTERS: RatingFilter[] = ['ALL', 'EXPLICIT', 'CLEAN'];

/**
 * The single rule the whole app uses: a track counts as explicit only when it is
 * explicitly flagged. Unmarked (`undefined`) tracks are non-explicit, so the two
 * filter buckets always partition the library with no third pile hiding in it.
 */
export const isExplicit = (track: Track): boolean => track.explicit === true;

/** Keep only the tracks matching `filter`. `ALL` returns the array untouched. */
export function filterByRating(tracks: Track[], filter: RatingFilter): Track[] {
  if (filter === 'ALL') return tracks;
  const wantExplicit = filter === 'EXPLICIT';
  return tracks.filter((t) => isExplicit(t) === wantExplicit);
}

/**
 * Best-effort rating from the "[Explicit]" / "[Clean]" convention publishers put
 * in titles and album names (also handles parenthesised and bare forms). Returns
 * `undefined` when the text says nothing, so it never overrides a real tag with a
 * guess. Explicit wins ties — a string carrying both markers is treated explicit.
 */
export function explicitFromText(...texts: (string | undefined)[]): boolean | undefined {
  const blob = texts.filter(Boolean).join(' ');
  if (/(?:\[|\()?\bexplicit\b(?:\]|\))?/i.test(blob)) return true;
  if (/(?:\[|\()?\bclean\b(?:\]|\))?/i.test(blob)) return false;
  return undefined;
}

/**
 * Best-effort rating from a file's native tag block (music-metadata's
 * `metadata.native`, a map of tag-format → array of `{ id, value }`). Reads the
 * iTunes advisory that both MP4 (`rtng` atom) and ID3 (`ITUNESADVISORY` TXXX
 * frame) carry: 1/4 = explicit, 2 = clean, 0 = none. Returns `undefined` when no
 * such tag is present. Kept tolerant of shape because native values vary by
 * container and by music-metadata version.
 */
export function explicitFromNativeTags(
  native: Record<string, { id: string; value: unknown }[]> | undefined
): boolean | undefined {
  if (!native) return undefined;
  for (const tagFormat in native) {
    const tags = native[tagFormat];
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      const id = String(tag?.id ?? '').toUpperCase();
      const isAdvisory = id === 'RTNG' || id.includes('ITUNESADVISORY');
      if (!isAdvisory) continue;
      // TXXX frames arrive as { description, text }; atoms as a raw number/string.
      const raw = (tag.value as any)?.text ?? (tag.value as any)?.value ?? tag.value;
      const n = Number(Array.isArray(raw) ? raw[0] : raw);
      if (n === 1 || n === 4) return true;
      if (n === 2) return false;
      // 0 (none) is not "clean" — leave it unmarked so text/hand can still speak.
    }
  }
  return undefined;
}
