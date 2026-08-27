// Pure wire-graph logic. No React, no DOM — just graph math over node keys, so
// it is trivially testable (see wires.test.ts) and cannot corrupt player state.
//
// A "wire" links two desktop objects (a folder, a playlist, or a video root) so
// that playback flows from one into the next end-to-end, and back again when
// rewinding past the start. The player reads this graph at queue boundaries to
// decide what source to play after the current one runs out; it never mutates
// the graph. See [[architecture]] / the wires design for the layering.

/**
 * `album`/`artist` are DERIVED nodes: unlike folders/playlists/videos they aren't
 * objects the user made, they're tags. A library has hundreds, so they only
 * appear on the desktop once pinned (see library/pinnedNodes.ts); their `key` is
 * the album or artist name.
 */
export type WireKind = 'folder' | 'playlist' | 'video' | 'youtube' | 'album' | 'artist';

/** A wire endpoint: which desktop object, by its stable key (folder/video path, playlist id, album/artist name). */
export interface NodeRef {
  kind: WireKind;
  key: string;
}

/**
 * A directional link. `type` is reserved: 'continuous' is the only behaviour for
 * now, but the field exists so crossfade/shuffle/sync wires can be added later
 * without a data migration.
 */
export interface Wire {
  from: NodeRef;
  to: NodeRef;
  type: 'continuous';
}

/** Same object? (kind + key). */
export function sameNode(a: NodeRef | null, b: NodeRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.key === b.key;
}

/** The node a forward wire leads to from `from`, or null if none. */
export function nextNode(wires: Wire[], from: NodeRef | null): NodeRef | null {
  if (!from) return null;
  const w = wires.find((w) => sameNode(w.from, from));
  return w ? w.to : null;
}

/** The node that wires INTO `from` (for rewind), or null if none. */
export function prevNode(wires: Wire[], from: NodeRef | null): NodeRef | null {
  if (!from) return null;
  const w = wires.find((w) => sameNode(w.to, from));
  return w ? w.from : null;
}

/**
 * Would adding from->to create a cycle back to `from`? Cycles are ALLOWED (a
 * loop is the "rewind end-to-end forever" behaviour), so callers use this only
 * to detect/annotate loops, not to forbid them.
 */
export function wouldCycle(wires: Wire[], from: NodeRef, to: NodeRef): boolean {
  // Walk forward from `to`; if we arrive back at `from`, the new edge closes a loop.
  let node: NodeRef | null = to;
  const seen = new Set<string>();
  while (node) {
    if (sameNode(node, from)) return true;
    const id = `${node.kind}:${node.key}`;
    if (seen.has(id)) return false; // hit a pre-existing loop that doesn't include `from`
    seen.add(id);
    node = nextNode(wires, node);
  }
  return false;
}

/**
 * Add a wire under the v1 constraint: a strict chain — at most ONE wire out of a
 * node and ONE wire into a node. Adding a wire that reuses either endpoint
 * replaces the old wire on that endpoint (so re-dragging retargets instead of
 * silently doing nothing). A self-wire (from === to) is rejected. Cycles across
 * multiple nodes are allowed. Returns a new array; never mutates the input.
 */
export function addWire(wires: Wire[], w: Wire): Wire[] {
  if (sameNode(w.from, w.to)) return wires; // no self-loops
  const kept = wires.filter(
    (existing) => !sameNode(existing.from, w.from) && !sameNode(existing.to, w.to)
  );
  return [...kept, w];
}

/** Remove any wire touching `node` (either end). Used when its object is deleted. */
export function removeNode(wires: Wire[], node: NodeRef): Wire[] {
  return wires.filter((w) => !sameNode(w.from, node) && !sameNode(w.to, node));
}

/** Remove one specific wire (by both endpoints). */
export function removeWire(wires: Wire[], from: NodeRef, to: NodeRef): Wire[] {
  return wires.filter((w) => !(sameNode(w.from, from) && sameNode(w.to, to)));
}

/**
 * A 1-based playback order for every node touched by a wire: walk each chain
 * from its head (a node with an out-edge and no in-edge) numbering 1, 2, 3…
 * Lower number = earlier / higher priority; 1 is the starting point. Separate
 * chains each start at 1. Pure cycles (no head) are numbered from an arbitrary
 * member so they still get badges. Keyed by "kind:key".
 */
export function chainOrder(wires: Wire[]): Map<string, number> {
  const order = new Map<string, number>();
  if (wires.length === 0) return order;

  const hasIncoming = new Set(wires.map((w) => nodeKey(w.to)));
  const outTo = new Map(wires.map((w) => [nodeKey(w.from), w.to] as const));

  const walk = (start: NodeRef) => {
    let node: NodeRef | null = start;
    let n = 1;
    while (node && !order.has(nodeKey(node))) {
      order.set(nodeKey(node), n++);
      node = outTo.get(nodeKey(node)) ?? null;
    }
  };

  // Heads first, so every chain is numbered from its true start.
  for (const w of wires) {
    if (!hasIncoming.has(nodeKey(w.from))) walk(w.from);
  }
  // Whatever's left lives in a headless cycle — number it from wherever.
  for (const w of wires) {
    if (!order.has(nodeKey(w.from))) walk(w.from);
  }
  return order;
}

const nodeKey = (n: NodeRef) => `${n.kind}:${n.key}`;
