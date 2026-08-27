// Albums/artists the user pinned to the desktop as wirable icons.
//
// Contained: a persisted list + the pure helpers in library/pinnedNodes. It owns
// no playback — the player resolves an album/artist node itself in `playSource`,
// exactly as it does a folder or a playlist.
import React from 'react';
import type { Track } from '../types';
import { usePersistentState } from './usePersistentState';
import {
  addPin,
  removePin,
  hasPin,
  prunePins,
  type PinnedNode,
  type PinKind,
} from '../library/pinnedNodes';

export interface UsePinnedNodes {
  /** Pins whose album/artist still exists in the library — what the desktop shows. */
  pins: PinnedNode[];
  pin: (kind: PinKind, key: string) => void;
  unpin: (kind: PinKind, key: string) => void;
  isPinned: (kind: PinKind, key: string) => boolean;
  toggle: (kind: PinKind, key: string) => void;
}

export function usePinnedNodes(tracks: Track[]): UsePinnedNodes {
  const [stored, setStored] = usePersistentState<PinnedNode[]>('brutal-pinned-nodes', []);

  // Stale pins (album deleted, tag edited) are filtered OUT OF THE VIEW but kept
  // in storage. Pruning the stored list instead would be destructive: the
  // library loads async, so at mount `tracks` is empty and an eager prune would
  // delete every pin the user ever made.
  const pins = React.useMemo(() => prunePins(stored, tracks), [stored, tracks]);

  const pin = React.useCallback(
    (kind: PinKind, key: string) => setStored((prev) => addPin(prev, { kind, key })),
    [setStored]
  );

  const unpin = React.useCallback(
    (kind: PinKind, key: string) => setStored((prev) => removePin(prev, { kind, key })),
    [setStored]
  );

  // Reads the STORED list, not the pruned view: a pin whose library is still
  // loading is pinned, and the button must not offer to pin it again.
  const isPinned = React.useCallback(
    (kind: PinKind, key: string) => hasPin(stored, { kind, key }),
    [stored]
  );

  const toggle = React.useCallback(
    (kind: PinKind, key: string) => (isPinned(kind, key) ? unpin(kind, key) : pin(kind, key)),
    [isPinned, unpin, pin]
  );

  return { pins, pin, unpin, isPinned, toggle };
}
