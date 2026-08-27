// Pure derivation of everything the artist page shows about a library: which
// tracks are theirs, what they add up to, and which albums they span. No React,
// no network, no DOM — see artistPage.test.ts.
import type { Track } from '../types';
import { normalizeArtist, splitArtists } from '../utils/artistCredits';

export interface ArtistTrackSplit {
  /** Tracks tagged exactly to this artist. Matches the artists-list grouping. */
  own: Track[];
  /**
   * Every OTHER track that credits them — as a guest ("Damian Marley feat. Nas")
   * or inside a combined tag ("Nas feat. Damian Marley", which is its own entry
   * in the artists list and so isn't in `own`).
   *
   * This is the whole point of the split: `own` alone is an exact string match,
   * so an artist page used to silently hide every feature they ever did.
   */
  appearsOn: Track[];
}

/**
 * Split a library into an artist's own tracks and the ones they appear on.
 *
 * `own` stays an EXACT tag match on purpose: it's what the artists list counted
 * when it offered this name, so the page's main list agrees with the number the
 * user clicked. Everything else credited to them lands in `appearsOn` rather
 * than being dropped.
 */
export function splitArtistTracks(tracks: Track[], artist: string): ArtistTrackSplit {
  const want = normalizeArtist(artist);
  const own: Track[] = [];
  const appearsOn: Track[] = [];
  if (!want) return { own, appearsOn };

  for (const t of tracks) {
    if (t.artist === artist) {
      own.push(t);
      continue;
    }
    if (splitArtists(t.artist || '').some((n) => normalizeArtist(n) === want)) {
      appearsOn.push(t);
    }
  }
  return { own, appearsOn };
}

export interface ArtistStats {
  trackCount: number;
  albumCount: number;
  /** Total runtime in seconds. 0 when no track carries a duration. */
  totalDuration: number;
}

/** Headline numbers for the stats strip. Counts distinct non-empty albums. */
export function artistStats(tracks: Track[]): ArtistStats {
  const albums = new Set<string>();
  let totalDuration = 0;
  for (const t of tracks) {
    const a = (t.album || '').trim();
    if (a) albums.add(a);
    totalDuration += t.duration ?? 0;
  }
  return { trackCount: tracks.length, albumCount: albums.size, totalDuration };
}

/**
 * Runtime for the stats strip: "48M", "3H 12M", "0M". An artist's discography
 * runs to hours, so utils/format#formatTime (mm:ss, built for one track's
 * transport) would render "192:34" here.
 */
export function formatRuntime(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return hours > 0 ? `${hours}H ${mins}M` : `${mins}M`;
}

export interface ArtistAlbum {
  album: string;
  coverUrl?: string;
  count: number;
}

/**
 * The artist's albums, most-tracks-first, each with the first cover found among
 * its tracks. Ties break alphabetically so the row doesn't reshuffle between
 * renders for no reason.
 */
export function artistAlbums(tracks: Track[]): ArtistAlbum[] {
  const byAlbum = new Map<string, ArtistAlbum>();
  for (const t of tracks) {
    const album = (t.album || '').trim();
    if (!album) continue;
    const existing = byAlbum.get(album);
    if (existing) {
      existing.count++;
      if (!existing.coverUrl && t.coverUrl) existing.coverUrl = t.coverUrl;
    } else {
      byAlbum.set(album, { album, coverUrl: t.coverUrl, count: 1 });
    }
  }
  return [...byAlbum.values()].sort(
    (a, b) => b.count - a.count || a.album.localeCompare(b.album)
  );
}
