import React from 'react';
import { Pin } from 'lucide-react';
import { useIconLocked } from '../hooks/useIconLock';

// Makes a desktop icon freely movable on the canvas. It wraps the existing icon
// button (folder / playlist / video) in an absolutely-positioned layer and turns
// a body-drag into a move, while leaving clicks, double-clicks, right-clicks and
// HTML5 drops on the inner button untouched (a stationary press never moves). The
// wire connect-handle lives above this in WiresLayer, so dragging the handle
// starts a wire instead of moving the icon.
//
// Icons are kept inside the desktop: a drag can't push one off any edge, and any
// icon that ends up out of bounds (window resize, an old saved position) is
// pulled back into view.
//
// An icon pinned in place (right-click → PIN_IN_PLACE, see useIconLock) refuses
// to start a drag and wears a pin badge. Everything else about it is unchanged:
// it still opens, still wires, and is still clamped back into view on resize.

export interface IconPos { x: number; y: number; }

// Icon geometry is uniform (w-24 button, 56px icon box at the top with p-2), so
// the wire anchor — the centre of that box — is a fixed offset from the icon's
// top-left. WiresLayer imports this to line cables up without measuring the DOM.
export const ICON_ANCHOR = { dx: 48, dy: 36 };

const DRAG_THRESHOLD = 4; // px before a press becomes a move (so clicks survive)
const BOTTOM_RESERVE = 96; // keep icons clear of the floating taskbar

interface DesktopIconProps {
  id: string;
  pos: IconPos;
  onMove: (id: string, pos: IconPos) => void;
  children: React.ReactNode;
}

export const DesktopIcon: React.FC<DesktopIconProps> = ({ id, pos, onMove, children }) => {
  const locked = useIconLocked(id);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ sx: number; sy: number; bx: number; by: number; pid: number; moved: boolean } | null>(null);
  // Window listeners live for the length of one press, so they must read the
  // current id/onMove without being torn down and rebuilt on every render.
  const cb = React.useRef({ id, onMove });
  cb.current = { id, onMove };

  // The desktop container this icon lives in, plus the zoom factor between screen
  // pixels (pointer deltas) and layout pixels (left/top). The desktop sits inside
  // a CSS `zoom` container, so a raw client delta over-/under-shoots without this.
  const metrics = () => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return null;
    const rect = parent.getBoundingClientRect();
    const scale = parent.clientWidth ? rect.width / parent.clientWidth : 1;
    const maxX = Math.max(0, parent.clientWidth - el.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - el.offsetHeight - BOTTOM_RESERVE);
    return { scale, maxX, maxY };
  };

  const clamp = (x: number, y: number, m: { maxX: number; maxY: number }): IconPos => ({
    x: Math.min(Math.max(0, x), m.maxX),
    y: Math.min(Math.max(0, y), m.maxY),
  });

  // Rescue: if this icon renders out of bounds (resize, or a stale saved spot),
  // pull it back inside. Idempotent — clamping an in-bounds icon is a no-op.
  React.useLayoutEffect(() => {
    const m = metrics();
    if (!m) return;
    const c = clamp(pos.x, pos.y, m);
    if (c.x !== pos.x || c.y !== pos.y) onMove(id, c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.x, pos.y]);

  React.useEffect(() => {
    const onResize = () => {
      const m = metrics();
      if (!m) return;
      const c = clamp(pos.x, pos.y, m);
      if (c.x !== pos.x || c.y !== pos.y) onMove(id, c);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // The whole press runs on window listeners that exist ONLY between pointerdown
  // and pointerup. Two reasons, both bugs we hit with element-level handlers:
  //
  //  - Pointer capture was the old way to keep moves coming once the cursor left
  //    the icon, but capture can be lost (a native drag, a re-mount), and then
  //    the release never reaches this element. The drag state stayed set, and the
  //    next plain *hover* over the icon was read as a continuing drag from a long
  //    stale origin — the icon shot away from the cursor or stuck to it.
  //  - Window listeners can't leak that way: no press, no listeners, so hovering
  //    is inert. A release anywhere on screen ends the drag.
  //
  // We still never capture the pointer, so click / dblclick / contextmenu on the
  // inner button are untouched and a stationary press stays a plain click.

  // The exact listener instances currently attached. Removing by identity matters:
  // onWinMove/onWinUp are re-created every render, so removing "the current one"
  // would miss the one that was actually added and the drag would never let go.
  const attached = React.useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);

  const endDrag = React.useCallback(() => {
    const h = attached.current;
    if (!h) return;
    attached.current = null;
    window.removeEventListener('pointermove', h.move);
    window.removeEventListener('pointerup', h.up);
    window.removeEventListener('pointercancel', h.up);
  }, []);

  function onWinMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    // No button held means the release was missed (a native drag ate it, or it
    // happened in another window). Bail out rather than tracking a ghost drag.
    if (e.buttons === 0) {
      drag.current = null;
      endDrag();
      return;
    }
    const dxScreen = e.clientX - d.sx;
    const dyScreen = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
    d.moved = true;
    const m = metrics();
    const scale = m?.scale || 1;
    const next = { x: d.bx + dxScreen / scale, y: d.by + dyScreen / scale };
    const { id: curId, onMove: move } = cb.current;
    move(curId, m ? clamp(next.x, next.y, m) : { x: Math.max(0, next.x), y: Math.max(0, next.y) });
  }

  function onWinUp(e: PointerEvent) {
    const d = drag.current;
    if (d && e.pointerId !== d.pid) return;
    drag.current = null;
    endDrag();
    if (d?.moved) {
      // A drag ends with a click; eat exactly that one so it can't open a window.
      const el = ref.current;
      if (!el) return;
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        el.removeEventListener('click', swallow, true);
      };
      el.addEventListener('click', swallow, true);
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right/middle stay with the inner button (menu)
    // Pinned in place: no listeners at all, so the press stays a plain click and
    // double-click / drop / right-click on the inner button still work.
    if (locked) return;
    endDrag(); // paranoia: never stack listeners from an unfinished press
    drag.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y, pid: e.pointerId, moved: false };
    const h = { move: onWinMove, up: onWinUp };
    attached.current = h;
    window.addEventListener('pointermove', h.move);
    window.addEventListener('pointerup', h.up);
    window.addEventListener('pointercancel', h.up);
  };

  // Never leave listeners behind if the icon unmounts mid-drag (unpinned, folder
  // removed, stations toggled off).
  React.useEffect(() => endDrag, [endDrag]);

  return (
    <div
      ref={ref}
      className="absolute pointer-events-auto"
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      // Tiles that wear artwork (pins, YouTube, stations) contain an <img>, and
      // images are natively draggable — pressing on the photo started an HTML5
      // image drag and the icon simply refused to move. Killing dragstart here
      // covers every icon kind at once, including ones added later. Dropping
      // tracks ONTO a playlist icon is unaffected: that's a drag started
      // elsewhere, and only drops land here.
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    >
      {children}
      {/* Pin badge. pointer-events-none so it can never swallow a click meant
          for the tile, and z-10 to sit over the artwork on image tiles. */}
      {locked && (
        <span
          className="absolute top-1 right-1 z-10 pointer-events-none p-0.5 bg-brutal-black border border-brutal-neon text-brutal-neon"
          title="PINNED_IN_PLACE"
        >
          <Pin size={9} />
        </span>
      )}
    </div>
  );
};
