// Pure state for the cross-window track-drag SESSION. No React/DOM/Electron.
//
// Why this exists: native HTML5 drag-and-drop (see trackDrag.ts) works only
// WITHIN one document — its dragover/drop events never fire in another OS
// window. So once windows are separate processes, a drag that starts in window A
// can't light up or drop onto a zone in window B through the DOM at all. The
// only channel that crosses is the main process: the drag source publishes the
// track id here, main holds it as the "active session" and tells every window,
// and a drop zone in any window resolves the id from this session.
//
// This module is just the rule for that resolution + the tiny state machine, so
// it's testable without a browser and both processes agree on the semantics.
//
// Run the tests with: npx tsx src/utils/dragSession.test.ts

export interface DragState {
  /** The track id currently being dragged, or null when nothing is dragging. */
  trackId: string | null;
}

export const NO_DRAG: DragState = { trackId: null };

export function withDragBegin(trackId: string): DragState {
  return { trackId };
}

export function withDragEnd(): DragState {
  return { trackId: null };
}

export function isDragging(s: DragState): boolean {
  return s.trackId !== null;
}

/**
 * The track id for a drop. Prefers the NATIVE dataTransfer id — that's a
 * same-window drop, always the source of truth — and falls back to the
 * main-process session only when native is absent, i.e. a cross-window drop
 * where no dataTransfer crossed. Returns null when neither has one.
 */
export function resolveDroppedTrackId(nativeId: string | null, session: DragState): string | null {
  return nativeId ?? session.trackId;
}
