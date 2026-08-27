import React from 'react';
import { resolveDroppedTrackId, type DragState } from './dragSession';

// One place that knows how a dragged track is encoded. Both the drag source
// (folder/library rows) and the drop targets (playlist icons and the playlist
// window) import from here, so the wire format can't drift between them.
//
// TWO transports live here now:
//  1. Native HTML5 drag-and-drop (dataTransfer) — the fast path for drops WITHIN
//     one document. Unchanged; this is what every current same-window drop uses.
//  2. A main-process drag SESSION — the ONLY channel that reaches another OS
//     window, because HTML5 drag events never cross windows. The source also
//     publishes the track id there; a cross-window drop zone resolves it from the
//     session (see useCrossWindowDrag + dragSession.ts). Publishing no-ops
//     outside Electron, so nothing changes in the browser or same-window today.

/** Custom MIME so drop zones ignore file drags, text selections, etc. */
export const TRACK_MIME = 'application/x-brutal-track-id';

interface DndBridge {
  dndBegin?: (trackId: string) => void;
  dndEnd?: () => void;
  onDndActive?: (cb: (trackId: string | null) => void) => () => void;
}
const bridge = (): DndBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as DndBridge | undefined;

/** Mark a DragEvent as carrying a track. Call from the source's onDragStart. */
export function setTrackDrag(e: React.DragEvent, trackId: string) {
  e.dataTransfer.setData(TRACK_MIME, trackId);
  // A text/plain fallback keeps the OS drag image sensible and lets the drag
  // start even where the custom type is filtered.
  e.dataTransfer.setData('text/plain', trackId);
  e.dataTransfer.effectAllowed = 'copy';

  // Also open a main-process session so a drop zone in ANOTHER window can find
  // this track. Capture the DOM node now (SyntheticEvent fields don't survive
  // async) and auto-close the session when the drag ends.
  const api = bridge();
  if (api?.dndBegin) {
    api.dndBegin(trackId);
    const el = e.currentTarget as HTMLElement;
    el.addEventListener('dragend', () => api.dndEnd?.(), { once: true });
  }
}

/** True when a drag in progress is one of ours (used to light up drop zones). */
export function isTrackDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TRACK_MIME);
}

/** The track id from a same-window drop, or null if the drop wasn't a track. */
export function getTrackDrag(e: React.DragEvent): string | null {
  return e.dataTransfer.getData(TRACK_MIME) || null;
}

/**
 * Resolve a drop's track id from EITHER the native dataTransfer (same-window) or
 * the cross-window session. Drop zones that must accept both call this instead
 * of getTrackDrag. `session` comes from useCrossWindowDrag().
 */
export function getTrackDropId(e: React.DragEvent, session: DragState): string | null {
  return resolveDroppedTrackId(getTrackDrag(e), session);
}

/**
 * Subscribe to the cross-window drag session. Returns the currently-dragged
 * track id (or null) so a drop zone in any window can light up while a drag is
 * in flight AND resolve the id on drop. Inert outside Electron. Drop zones adopt
 * this when windows become separate processes (Phase 4); it changes nothing for
 * same-window drops, which still resolve through native dataTransfer.
 */
export function useCrossWindowDrag(): DragState {
  const [state, setState] = React.useState<DragState>({ trackId: null });
  React.useEffect(() => {
    const api = bridge();
    if (!api?.onDndActive) return;
    return api.onDndActive((trackId) => setState({ trackId }));
  }, []);
  return state;
}
