// The one definition of how a track list is ordered. Pure — no React, no DOM —
// so both the Media Library and the folder-explorer windows sort identically and
// a ~15-line test pins the behaviour. `mode.<MODE>` i18n keys label these.

import type { Track } from '../types';

/**
 * The orderings offered for any track list. `DEFAULT` keeps the caller's incoming
 * order — the master library order for the Media Library, or a folder's
 * name-sorted listing in an explorer window — so it never imposes an order of
 * its own.
 */
export type LibrarySortMode = 'DEFAULT' | 'A-Z' | 'Z-A' | 'ARTIST' | 'ALBUM' | 'DURATION';

/** Every mode, in menu order. The sort UIs iterate this instead of re-listing. */
export const SORT_MODES: LibrarySortMode[] = ['DEFAULT', 'A-Z', 'Z-A', 'ARTIST', 'ALBUM', 'DURATION'];

/**
 * Order `tracks` by `mode`. `DEFAULT` returns the same array untouched; every
 * other mode returns a new, sorted copy (the input is never mutated).
 */
export function sortTracks(tracks: Track[], mode: LibrarySortMode): Track[] {
  if (mode === 'DEFAULT') return tracks;
  return [...tracks].sort((a, b) => {
    switch (mode) {
      case 'A-Z': return a.name.localeCompare(b.name);
      case 'Z-A': return b.name.localeCompare(a.name);
      case 'ARTIST': return a.artist.localeCompare(b.artist);
      case 'ALBUM': return a.album.localeCompare(b.album);
      case 'DURATION': return (b.duration || 0) - (a.duration || 0);
      default: return 0;
    }
  });
}
