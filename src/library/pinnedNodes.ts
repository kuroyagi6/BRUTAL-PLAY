// Pure logic for albums/artists pinned to the desktop as wirable icons.
//
// Folders, playlists and videos are objects the user made, so the desktop just
// shows them all. Albums and artists are DERIVED from tags — a library has
// hundreds — so they only reach the desktop by being pinned, and this module
// owns that list plus the "what does this node play?" resolution.
//
// No React, no DOM, no IndexedDB — see pinnedNodes.test.ts.
import type { Track } from '../types';
import { splitArtistTracks } from './artistPage';

export type PinKind = 'album' | 'artist';

/** A pinned desktop node. `key` is the album name or the artist name. */
export interface PinnedNode {
  kind: PinKind;
  key: string;
}

/** Stable id, matching the `kind:key` convention used by wires + icon positions. */
export const pinId = (p: PinnedNode): string => `${p.kind}:${p.key}`;

export const samePin = (a: PinnedNode, b: PinnedNode): boolean =>
  a.kind === b.kind && a.key === b.key;

export const hasPin = (pins: PinnedNode[], p: PinnedNode): boolean =>
  pins.some((x) => samePin(x, p));

/** Add a pin unless it's already there. Never mutates; ignores a blank key. */
export function addPin(pins: PinnedNode[], p: PinnedNode): PinnedNode[] {
  if (!p.key.trim() || hasPin(pins, p)) return pins;
  return [...pins, p];
}

export function removePin(pins: PinnedNode[], p: PinnedNode): PinnedNode[] {
  return pins.filter((x) => !samePin(x, p));
}

/**
 * Tracks on an album, in library order.
 *
 * Keyed by album NAME only — deliberately the same grouping the library's albums
 * tab uses, so a pinned album holds exactly what its album page shows. (Two
 * different artists with an identically-named album therefore merge; that is
 * pre-existing library behaviour, not something this layer invents.)
 */
export function albumTracks(tracks: Track[], album: string): Track[] {
  if (!album.trim()) return [];
  return tracks.filter((t) => t.album === album);
}

/**
 * Tracks an artist node plays: EVERYTHING crediting them — their own tracks
 * first, then the ones they appear on.
 *
 * Not an exact-tag match (the user's call): a "Nas" icon that skipped "Nas feat.
 * Damian Marley" would be missing his own songs. This is exactly the union of
 * the artist page's TRACKS + APPEARS ON, so the icon plays what the page shows.
 */
export function artistNodeTracks(tracks: Track[], artist: string): Track[] {
  const { own, appearsOn } = splitArtistTracks(tracks, artist);
  return [...own, ...appearsOn];
}

/** What a pinned node plays. */
export function pinTracks(tracks: Track[], p: PinnedNode): Track[] {
  return p.kind === 'album' ? albumTracks(tracks, p.key) : artistNodeTracks(tracks, p.key);
}

/** Just the ids — what the player's queue actually wants. */
export const pinTrackIds = (tracks: Track[], p: PinnedNode): string[] =>
  pinTracks(tracks, p).map((t) => t.id);

/** Cover art for the icon: the first cover among the node's tracks. */
export const pinCover = (tracks: Track[], p: PinnedNode): string | undefined =>
  pinTracks(tracks, p).find((t) => t.coverUrl)?.coverUrl;

/**
 * Drop pins whose album/artist no longer exists in the library (the files were
 * removed, or a tag was edited). Without this a stale icon sits on the desktop
 * wired into a chain and silently plays nothing.
 */
export function prunePins(pins: PinnedNode[], tracks: Track[]): PinnedNode[] {
  return pins.filter((p) => pinTracks(tracks, p).length > 0);
}
