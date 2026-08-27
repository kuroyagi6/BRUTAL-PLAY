import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { ChevronDown, Maximize2, Minimize2, Power, ExternalLink } from 'lucide-react';
import { rectForTarget, edgeTargetFromPoint, type SnapZone, type EdgeTarget } from './windowSnap';

/** Imperative handle so App can drive the focused window from a keybind. */
export interface BrutalWindowHandle {
  toggleMaximize: () => void;
  /** Un-maximize back to windowed size (no-op if already windowed). */
  restore: () => void;
  /** Snap to a half/quadrant of the desktop (split-screen). */
  snap: (zone: SnapZone) => void;
}

interface BrutalWindowProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  initialPos?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  isMinimized: boolean;
  onMinimize: () => void;
  onClose?: () => void;
  /** When provided, shows a "pop out to its own OS window" button in the titlebar. */
  onPopOut?: () => void;
  /** Open maximized (fills the desktop) instead of floating at initialPos/size. */
  defaultMaximized?: boolean;
  zIndex: number;
  onFocus?: () => void;
  minWidth?: number;
  minHeight?: number;
  dragConstraints?: React.RefObject<Element>;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  resetToken?: number;
}

let globalZIndex = 10;

export const BrutalWindow = React.forwardRef<BrutalWindowHandle, BrutalWindowProps>(function BrutalWindow({
  id,
  title,
  icon,
  children,
  initialPos = { x: 0, y: 0 },
  initialSize = { width: 400, height: 500 },
  isMinimized,
  onMinimize,
  onClose,
  onPopOut,
  defaultMaximized = false,
  zIndex,
  onFocus,
  minWidth = 240,
  minHeight = 180,
  onInteractionStart,
  onInteractionEnd,
  resetToken,
}, ref) {
  const [size, setSize] = useState(initialSize);
  const [isMaximized, setIsMaximized] = useState(defaultMaximized);
  const [isDragging, setIsDragging] = useState(false);
  const [internalZIndex, setInternalZIndex] = useState(zIndex);
  // True only for the length of a maximize/restore. The window is otherwise
  // transition-less on purpose (see the `transition` style below), so the grow
  // is armed just before the size change and disarmed right after.
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimer = useRef<number | null>(null);

  // Split-screen: the live drag-to-edge preview (null when not near an edge) and
  // the hover snap-layout menu on the maximize button.
  const [snapPreview, setSnapPreview] = useState<{ target: EdgeTarget; rect: ReturnType<typeof rectForTarget> } | null>(null);
  const [showSnapMenu, setShowSnapMenu] = useState(false);
  // Delayed close so crossing the small gap between the button and the menu
  // doesn't blink it shut; re-entering either element cancels the pending close.
  const snapMenuCloseTimer = useRef<number | null>(null);
  const openSnapMenu = () => {
    if (snapMenuCloseTimer.current !== null) {
      clearTimeout(snapMenuCloseTimer.current);
      snapMenuCloseTimer.current = null;
    }
    setShowSnapMenu(true);
  };
  const closeSnapMenu = () => {
    if (snapMenuCloseTimer.current !== null) clearTimeout(snapMenuCloseTimer.current);
    snapMenuCloseTimer.current = window.setTimeout(() => {
      setShowSnapMenu(false);
      snapMenuCloseTimer.current = null;
    }, 120);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  // Store current position as plain refs — no motion value overhead
  const posRef = useRef({ x: initialPos.x, y: initialPos.y });
  // The desktop element to portal the drag-snap preview into (captured at drag start).
  const snapParentRef = useRef<HTMLElement | null>(null);

  // Any drag/resize must win over a still-running maximize animation, or the
  // window trails the cursor for the rest of it.
  const stopZoom = () => {
    if (zoomTimer.current) {
      clearTimeout(zoomTimer.current);
      zoomTimer.current = null;
    }
    setIsZooming(false);
  };

  useEffect(() => () => stopZoom(), []);

  const bringToFront = () => {
    globalZIndex++;
    setInternalZIndex(globalZIndex);
    onFocus?.();
  };

  useEffect(() => {
    if (!isMinimized) bringToFront();
  }, [isMinimized]);

  useEffect(() => {
    if (resetToken && resetToken > 0) {
      posRef.current = { x: initialPos.x, y: initialPos.y };
      applyTransform(initialPos.x, initialPos.y);
      setSize(initialSize);
      setIsMaximized(defaultMaximized);
    }
  }, [resetToken]);

  const applyTransform = (x: number, y: number) => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  };

  // The app zooms the page (html { zoom: 0.9 }), so 1px of cursor travel is
  // more than 1px of layout distance. Divide cursor deltas by the zoom factor
  // or windows drift behind the cursor.
  const getPageZoom = () => {
    const z = parseFloat((getComputedStyle(document.documentElement) as any).zoom);
    return z && z > 0 ? z : 1;
  };

  // ─── RAW POINTER DRAG ──────────────────────────────────────────────────────
  // No React state updates during move — just direct DOM writes like Windows.
  const startDrag = (e: React.PointerEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();

    stopZoom();
    bringToFront();
    onInteractionStart?.();
    setIsDragging(true);

    const zoom = getPageZoom();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPosX = posRef.current.x;
    const startPosY = posRef.current.y;

    // Drag-to-edge (Aero Snap): map the cursor to a desktop edge and preview the
    // zone. Captured once at drag start; the preview updates only when the target
    // changes (not every frame). Dropping on a zone snaps instead of committing
    // the free position.
    const parent = (containerRef.current?.offsetParent as HTMLElement | null) ?? null;
    snapParentRef.current = parent;
    let dropTarget: EdgeTarget | null = null;

    const detectEdge = (ev: PointerEvent): EdgeTarget | null => {
      if (!parent) return null;
      const rect = parent.getBoundingClientRect();
      const relX = (ev.clientX - rect.left) / zoom;
      const relY = (ev.clientY - rect.top) / zoom;
      return edgeTargetFromPoint(relX, relY, parent.clientWidth, parent.clientHeight, { threshold: 28 });
    };

    const onMove = (moveEvent: PointerEvent) => {
      const newX = startPosX + (moveEvent.clientX - startMouseX) / zoom;
      const newY = startPosY + (moveEvent.clientY - startMouseY) / zoom;
      applyTransform(newX, newY);

      const target = detectEdge(moveEvent);
      if (target !== dropTarget) {
        dropTarget = target;
        if (parent && target) {
          setSnapPreview({ target, rect: rectForTarget(target, parent.clientWidth, parent.clientHeight) });
        } else {
          setSnapPreview(null);
        }
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      setSnapPreview(null);
      setIsDragging(false);
      onInteractionEnd?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      // Snap wins over the free drop position when released over an edge zone.
      if (dropTarget) {
        applySnap(dropTarget);
        return;
      }
      const newX = startPosX + (upEvent.clientX - startMouseX) / zoom;
      const newY = startPosY + (upEvent.clientY - startMouseY) / zoom;
      posRef.current = { x: newX, y: newY };
      applyTransform(newX, newY);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── RAW POINTER RESIZE ────────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent, direction: string) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    stopZoom();
    bringToFront();
    onInteractionStart?.();

    const zoom = getPageZoom();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;
    const startPosX = posRef.current.x;
    const startPosY = posRef.current.y;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;

      let newW = startW;
      let newH = startH;
      let newX = startPosX;
      let newY = startPosY;

      if (direction.includes('e')) newW = Math.max(minWidth, startW + dx);
      if (direction.includes('s')) newH = Math.max(minHeight, startH + dy);
      if (direction.includes('w')) {
        const pw = startW - dx;
        if (pw > minWidth) { newW = pw; newX = startPosX + dx; }
      }
      if (direction.includes('n')) {
        const ph = startH - dy;
        if (ph > minHeight) { newH = ph; newY = startPosY + dy; }
      }

      if (containerRef.current) {
        containerRef.current.style.width = `${newW}px`;
        containerRef.current.style.height = `${newH}px`;
        containerRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      const dx = (upEvent.clientX - startX) / zoom;
      const dy = (upEvent.clientY - startY) / zoom;

      let newX = startPosX;
      let newY = startPosY;
      let newW = startW;
      let newH = startH;

      if (direction.includes('e')) newW = Math.max(minWidth, startW + dx);
      if (direction.includes('s')) newH = Math.max(minHeight, startH + dy);
      if (direction.includes('w')) {
        const pw = startW - dx;
        if (pw > minWidth) { newW = pw; newX = startPosX + dx; }
      }
      if (direction.includes('n')) {
        const ph = startH - dy;
        if (ph > minHeight) { newH = ph; newY = startPosY + dy; }
      }

      posRef.current = { x: newX, y: newY };
      setSize({ width: newW, height: newH });
      applyTransform(newX, newY);

      document.body.style.cursor = 'default';
      onInteractionEnd?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    const cur =
      direction === 'nw' || direction === 'se' ? 'nwse-resize' :
      direction === 'ne' || direction === 'sw' ? 'nesw-resize' :
      direction === 'n'  || direction === 's'  ? 'ns-resize'   : 'ew-resize';
    document.body.style.cursor = cur;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const ZOOM_MS = 220;

  // Arm the one-shot grow/shrink transition; the render reads isMaximized/posRef
  // for both ends, so nothing is written imperatively here (that would jump the
  // window before the transition ran).
  const armZoom = () => {
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    setIsZooming(true);
    zoomTimer.current = window.setTimeout(() => {
      zoomTimer.current = null;
      setIsZooming(false);
    }, ZOOM_MS);
  };

  const toggleMaximize = () => {
    armZoom();
    setIsMaximized(prev => !prev);
    bringToFront();
  };

  // Double-tap the header to flip between MAXIMIZED and RESTORED (windowed): a
  // maximized window drops back to its floating size, any other window maximizes.
  const toggleMaxMin = () => {
    if (isMaximized) restoreDown();
    else toggleMaximize();
  };

  // The desktop area the window lives in (its positioned ancestor). clientW/H are
  // layout px — the same space as the window's size/transform, so no zoom math is
  // needed here (unlike cursor coords). Returns null if the window is detached.
  const desktopSize = () => {
    const parent = containerRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return null;
    return { W: parent.clientWidth, H: parent.clientHeight };
  };

  // Snap to a half/quadrant. Un-maximizes and moves+resizes to the exact tile;
  // the zoom transition animates it. This is the shared core for all three
  // triggers (drag-to-edge, the hover menu, and the keyboard shortcut).
  const applySnap = (target: EdgeTarget) => {
    if (target === 'maximize') {
      armZoom();
      setIsMaximized(true);
      bringToFront();
      return;
    }
    const d = desktopSize();
    if (!d) return;
    const r = rectForTarget(target, d.W, d.H);
    armZoom();
    setIsMaximized(false);
    posRef.current = { x: r.x, y: r.y };
    applyTransform(r.x, r.y);
    setSize({ width: r.width, height: r.height });
    bringToFront();
  };
  const snap = (zone: SnapZone) => applySnap(zone);

  // Restore to normal (windowed) size — the un-maximize half of the keybind pair.
  const restoreDown = () => {
    setIsMaximized((prev) => {
      if (prev) armZoom();
      return false;
    });
    bringToFront();
  };

  // Expose maximize/restore so a keybind (App) can drive the focused window.
  // Declared before the early return so the hook order is stable when minimized.
  useImperativeHandle(ref, () => ({ toggleMaximize, restore: restoreDown, snap }), []);

  if (isMinimized) return null;

  return (
    <div
      ref={containerRef}
      onPointerDown={() => bringToFront()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: isMaximized ? '100%' : size.width,
        height: isMaximized ? '100%' : size.height,
        // Restore animates back to where the window was last dragged to, not to
        // initialPos — posRef is the single source of truth for position.
        transform: isMaximized ? 'none' : `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`,
        // Use focus-order z-index even when maximized so multiple maximized
        // windows stack by most-recently-focused (kept below the taskbar's 9999).
        zIndex: internalZIndex,
        willChange: 'transform, width, height',
        // brutal-card applies transition-all; that would animate every drag
        // frame over 300ms and make the window trail behind the cursor. The only
        // animated moment is the maximize/restore zoom.
        transition: isZooming
          ? `width ${ZOOM_MS}ms cubic-bezier(0.2, 0, 0, 1), height ${ZOOM_MS}ms cubic-bezier(0.2, 0, 0, 1), transform ${ZOOM_MS}ms cubic-bezier(0.2, 0, 0, 1)`
          : 'none',
      }}
      className={`brutal-card p-0 flex flex-col overflow-hidden pointer-events-auto ${
        isMaximized
          ? 'shadow-none border-0'
          : 'shadow-[12px_12px_0px_0px_var(--brutal-shadow-color)] border-4 border-brutal-white'
      }`}
    >
      {/* Drag-to-edge snap preview — a ghost of the target zone, rendered into the
          desktop (not this window) so it isn't clipped and spans the real area. */}
      {snapPreview && snapParentRef.current && createPortal(
        <div
          className="pointer-events-none absolute border-4 border-brutal-neon bg-brutal-neon/20"
          style={{
            left: snapPreview.rect.x,
            top: snapPreview.rect.y,
            width: snapPreview.rect.width,
            height: snapPreview.rect.height,
            zIndex: 9998,
            transition: 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
          }}
        />,
        snapParentRef.current,
      )}

      {/* Module faceplate — drag handle. Screw dots + an LED sell "rack unit"
          rather than an OS titlebar; the controls are stow / solo / eject. */}
      <div
        className={`bg-brutal-white text-brutal-black border-b-4 border-brutal-black p-2 flex items-center justify-between select-none shrink-0 ${
          isMaximized ? 'cursor-default' : 'cursor-move'
        }`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startDrag(e);
        }}
        onDoubleClick={toggleMaxMin}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {/* faceplate screw */}
          <span className="w-1.5 h-1.5 rounded-full bg-brutal-black/30 shrink-0 hidden sm:block" aria-hidden />
          <div className="bg-brutal-black text-brutal-white p-1">
            {React.cloneElement(icon as React.ReactElement, { size: 14 })}
          </div>
          {/* power LED — lit while the module is showing */}
          <span className="w-1.5 h-1.5 rounded-full bg-brutal-neon shrink-0" aria-hidden />
          <span className="font-display text-sm uppercase truncate tracking-tight">{title}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            className="p-1 hover:bg-brutal-neon transition-colors border-2 border-transparent hover:border-brutal-black"
            title="STOW"
          >
            <ChevronDown size={14} strokeWidth={3} />
          </button>
          {onPopOut && (
            <button
              onClick={(e) => { e.stopPropagation(); onPopOut(); }}
              className="p-1 hover:bg-brutal-neon transition-colors border-2 border-transparent hover:border-brutal-black"
              title="POP OUT // own window"
            >
              <ExternalLink size={14} strokeWidth={3} />
            </button>
          )}
          <div
            className="relative"
            onPointerEnter={openSnapMenu}
            onPointerLeave={closeSnapMenu}
          >
            <button
              onClick={(e) => { e.stopPropagation(); toggleMaximize(); }}
              className="p-1 hover:bg-brutal-neon transition-colors border-2 border-transparent hover:border-brutal-black"
              title={isMaximized ? 'UNSOLO' : 'SOLO // hover to tile'}
            >
              {isMaximized ? <Minimize2 size={14} strokeWidth={3} /> : <Maximize2 size={14} strokeWidth={3} />}
            </button>

            {/* Tile menu: three mini-diagrams whose regions each snap the unit to
                that zone. Kept inside the window bounds so the card's
                overflow-hidden doesn't clip it. */}
            {showSnapMenu && (
              <div
                className="absolute right-0 top-full z-[60] mt-1 before:absolute before:-top-1 before:left-0 before:right-0 before:h-1 before:content-[''] bg-brutal-white text-brutal-black border-4 border-brutal-black p-2 flex gap-2 shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)]"
                onPointerEnter={openSnapMenu}
                onPointerLeave={closeSnapMenu}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/* Left / right halves */}
                <div className="flex w-14 h-10 border-2 border-brutal-black">
                  <SnapCell zone="left" onSnap={snap} className="border-r-2 border-brutal-black" />
                  <SnapCell zone="right" onSnap={snap} />
                </div>
                {/* Top / bottom halves */}
                <div className="flex flex-col w-14 h-10 border-2 border-brutal-black">
                  <SnapCell zone="top" onSnap={snap} className="border-b-2 border-brutal-black" />
                  <SnapCell zone="bottom" onSnap={snap} />
                </div>
                {/* Quadrants */}
                <div className="grid grid-cols-2 grid-rows-2 w-14 h-10 border-2 border-brutal-black">
                  <SnapCell zone="top-left" onSnap={snap} className="border-r-2 border-b-2 border-brutal-black" />
                  <SnapCell zone="top-right" onSnap={snap} className="border-b-2 border-brutal-black" />
                  <SnapCell zone="bottom-left" onSnap={snap} className="border-r-2 border-brutal-black" />
                  <SnapCell zone="bottom-right" onSnap={snap} />
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="p-1 hover:bg-red-500 hover:text-white transition-colors border-2 border-transparent hover:border-brutal-black"
              title="EJECT"
            >
              <Power size={14} strokeWidth={3} />
            </button>
          )}
        </div>
      </div>

      {/* Window Content */}
      <div
        className="flex-1 overflow-hidden relative bg-brutal-black"
        style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
      >
        {children}
      </div>

      {/* Resize Handles */}
      {!isMaximized && (
        <>
          <div onPointerDown={(e) => startResize(e, 'nw')} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 'ne')} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 'sw')} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 'se')} className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-50 flex items-end justify-end p-1 group">
            <div className="w-4 h-4 border-r-4 border-b-4 border-brutal-white/30 group-hover:border-brutal-neon transition-colors" />
          </div>
          <div onPointerDown={(e) => startResize(e, 'n')} className="absolute top-0 left-3 right-3 h-1 cursor-n-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 's')} className="absolute bottom-0 left-3 right-3 h-1 cursor-s-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 'w')} className="absolute top-3 bottom-3 left-0 w-1 cursor-w-resize z-50" />
          <div onPointerDown={(e) => startResize(e, 'e')} className="absolute top-3 bottom-3 right-0 w-1 cursor-e-resize z-50" />
        </>
      )}
    </div>
  );
});

/** One clickable region inside a snap-layout diagram. Snaps to `zone` on click. */
function SnapCell({
  zone,
  onSnap,
  className = '',
}: {
  zone: SnapZone;
  onSnap: (zone: SnapZone) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={zone.replace('-', ' ').toUpperCase()}
      onClick={(e) => { e.stopPropagation(); onSnap(zone); }}
      className={`flex-1 m-[1px] bg-brutal-black/10 hover:bg-brutal-neon transition-colors ${className}`}
    />
  );
}
