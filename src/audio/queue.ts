// Pure play-queue logic. No React, no DOM — just ordering math, so it is
// trivially testable (see queue.test.ts) and cannot corrupt player state.
//
// The "queue" is the ordered list of track IDs the user is playing (the sorted
// or filtered view they clicked from). next/prev follow THIS, not the master
// library order.

/** The queue filtered to tracks that still exist; master order as fallback. */
export function resolveQueue(masterIds: string[], queue: string[]): string[] {
  const valid = new Set(masterIds);
  const filtered = queue.filter((id) => valid.has(id));
  return filtered.length > 0 ? filtered : masterIds;
}

export interface AdjacentParams {
  masterIds: string[];
  queue: string[];
  currentId: string | null;
  dir: 1 | -1;
  shuffle: boolean;
  /** Injectable RNG for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

/** Pick the next (dir=1) or previous (dir=-1) track id, following the queue. */
export function pickAdjacent(params: AdjacentParams): string | null {
  const { masterIds, queue, currentId, dir, shuffle, random = Math.random } = params;
  if (masterIds.length === 0) return null;
  const q = resolveQueue(masterIds, queue);
  if (q.length === 0) return null;

  const pos = currentId ? q.indexOf(currentId) : -1;

  if (shuffle && q.length > 1) {
    let r = Math.floor(random() * q.length);
    if (r === pos) r = (r + 1) % q.length; // avoid replaying the same track
    return q[r];
  }

  // If the current track isn't in the queue, start from an edge.
  const from = pos === -1 ? (dir === 1 ? -1 : 0) : pos;
  return q[(from + dir + q.length) % q.length];
}

/** True when the current track is the last item of the active queue. */
export function isLastInQueue(masterIds: string[], queue: string[], currentId: string | null): boolean {
  const q = resolveQueue(masterIds, queue);
  const pos = currentId ? q.indexOf(currentId) : -1;
  return pos === q.length - 1;
}

/**
 * Decide which track should be "current" after the library changes.
 * Keeps the current track if it still exists; falls back to the first track;
 * null when the library is empty. Tracking current-by-id (not index) means
 * removing or reordering tracks never mis-points the current selection.
 */
export function reconcileCurrentId(playlistIds: string[], currentId: string | null): string | null {
  if (playlistIds.length === 0) return null;
  if (currentId && playlistIds.includes(currentId)) return currentId;
  return playlistIds[0];
}
