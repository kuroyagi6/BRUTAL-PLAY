// Pure window-snap geometry — no React, no DOM. Shared by BrutalWindow's snap
// handle, the drag-to-edge detector, and the hover snap menu so "where does a
// left-half go" has exactly one definition. Tested via
// `npx tsx src/components/windowSnap.test.ts`.

/** The eight tile targets a window can be snapped to (halves + quadrants). */
export type SnapZone =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** What a drag-to-edge gesture can resolve to: a tile, a full maximize, or none. */
export type EdgeTarget = SnapZone | 'maximize';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle a target occupies inside a WxH desktop. `maximize` fills it; the
 * eight zones are exact halves/quadrants (no gaps, no rounding drift) so two
 * windows snapped to opposite halves tile edge-to-edge.
 */
export function rectForTarget(target: EdgeTarget, W: number, H: number): Rect {
  const halfW = Math.round(W / 2);
  const halfH = Math.round(H / 2);
  switch (target) {
    case 'maximize':   return { x: 0,     y: 0,     width: W,        height: H };
    case 'left':       return { x: 0,     y: 0,     width: halfW,    height: H };
    case 'right':      return { x: halfW, y: 0,     width: W - halfW, height: H };
    case 'top':        return { x: 0,     y: 0,     width: W,        height: halfH };
    case 'bottom':     return { x: 0,     y: halfH, width: W,        height: H - halfH };
    case 'top-left':   return { x: 0,     y: 0,     width: halfW,    height: halfH };
    case 'top-right':  return { x: halfW, y: 0,     width: W - halfW, height: halfH };
    case 'bottom-left':return { x: 0,     y: halfH, width: halfW,    height: H - halfH };
    case 'bottom-right':return { x: halfW, y: halfH, width: W - halfW, height: H - halfH };
  }
}

export interface EdgeOptions {
  /** How close (in the same units as px/py/W/H) to an edge counts as a hit. */
  threshold?: number;
  /** Fraction of the edge length near each end that resolves to a corner zone. */
  cornerFraction?: number;
}

/**
 * Resolve a cursor position (px,py) inside a WxH area to a drag-snap target, or
 * null when the cursor isn't near an edge. Mirrors Windows Aero Snap:
 *   - left / right edge  -> that half, or the near quadrant at the ends
 *   - top edge (middle)  -> maximize
 * Left/right win over top so the top corners become quadrants, not maximize.
 */
export function edgeTargetFromPoint(
  px: number,
  py: number,
  W: number,
  H: number,
  opts: EdgeOptions = {},
): EdgeTarget | null {
  const threshold = opts.threshold ?? 24;
  const corner = opts.cornerFraction ?? 0.28;
  if (W <= 0 || H <= 0) return null;

  const nearTop = py <= H * corner;
  const nearBottom = py >= H * (1 - corner);

  if (px <= threshold) {
    return nearTop ? 'top-left' : nearBottom ? 'bottom-left' : 'left';
  }
  if (px >= W - threshold) {
    return nearTop ? 'top-right' : nearBottom ? 'bottom-right' : 'right';
  }
  if (py <= threshold) return 'maximize';
  return null;
}
