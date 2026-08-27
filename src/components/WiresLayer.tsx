import React from 'react';
import { chainOrder, type NodeRef, type Wire } from '../audio/wires';
import { ICON_ANCHOR, type IconPos } from './DesktopIcon';

// The visual wire layer, Figma/XD-style. It draws thin neon cables between
// desktop nodes and shows each wired node's play order as a small number badge
// (1 = start / highest priority — direction is read from the numbers, not an
// arrowhead). Create a wire by dragging a node's connect handle onto another
// node; cut one by clicking it. Pure presentation: it reads icon positions from
// App and calls back to add/remove wires — it never resolves tracks or plays.
// Sits above the icons (z-2), below windows; pointer-events:none except the
// handles and the cable hit-strips, so icons stay draggable underneath.

/** How a cable is routed between its jacks. 'curved' is the default look. */
export type WireShape = 'curved' | 'straight';
/** What runs through a connected cable. 'bolt' is the default look. */
export type WireCurrent = 'bolt' | 'quiet';

interface WiresLayerProps {
  wires: Wire[];
  /** Wirable node ids on the desktop ("folder:<path>" / "playlist:<id>"). */
  nodeIds: string[];
  /** Every desktop icon's resolved position, keyed by "kind:key". */
  positions: Record<string, IconPos>;
  onCreate: (from: NodeRef, to: NodeRef) => void;
  onRemove: (from: NodeRef, to: NodeRef) => void;
  /** Cable routing. Defaults to the original bézier. */
  shape?: WireShape;
  /** Cable animation. Defaults to the arcing bolt. */
  current?: WireCurrent;
}

interface Point { x: number; y: number; }

// "kind:key" — split on the FIRST colon only (folder keys are Windows paths that
// contain colons, e.g. "folder:C:\Music").
function parseNode(id: string): NodeRef {
  const i = id.indexOf(':');
  return { kind: id.slice(0, i) as NodeRef['kind'], key: id.slice(i + 1) };
}
const nodeId = (n: NodeRef) => `${n.kind}:${n.key}`;

// The wire anchor is the centre of an icon's box, a fixed offset from its
// top-left (icon geometry is uniform — see DesktopIcon).
const anchorOf = (pos: IconPos): Point => ({ x: pos.x + ICON_ANCHOR.dx, y: pos.y + ICON_ANCHOR.dy });

// Jacks sit on the icon's edges: OUT on the right, IN on the left, both at the
// icon box's vertical centre. The 56px box means each edge is 28px from centre;
// the jack sits a touch outside that.
const JACK_OFFSET = 30;
const jackOut = (a: Point): Point => ({ x: a.x + JACK_OFFSET, y: a.y });
const jackIn = (a: Point): Point => ({ x: a.x - JACK_OFFSET, y: a.y });

// CURVED (default): the cable flows OUT of the source jack (which faces right)
// and INTO the target (which is approached from the left, the way an IN jack
// opens). So the tangents are fixed to the jacks' facing — the cable always
// leaves rightward and arrives from the left, looping cleanly when the target
// sits back to the left. `a` is the out/source end, `b` the in/target end.
function cableControls(a: Point, b: Point): [Point, Point] {
  const off = Math.max(40, Math.abs(b.x - a.x) * 0.4);
  return [{ x: a.x + off, y: a.y }, { x: b.x - off, y: b.y }];
}

// STRAIGHT: a direct line, jack to jack. It ignores the jacks' facing (a target
// to the left is reached by cutting back across rather than looping), which is
// the point — it reads as a taut cable rather than a slack one.
function cablePath(a: Point, b: Point, shape: WireShape = 'curved'): string {
  if (shape === 'straight') return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const [c1, c2] = cableControls(a, b);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

// Where the cut affordance sits: the curve's t=0.5 point, or the line's midpoint.
function cableMid(a: Point, b: Point, shape: WireShape = 'curved'): Point {
  if (shape === 'straight') return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const [c1, c2] = cableControls(a, b);
  return {
    x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
    y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
  };
}

// A stable id for a wire (matches the <g> key), used to track which cables just
// connected so they can play the one-shot zap.
const wireId = (w: Wire) => `${nodeId(w.from)}->${nodeId(w.to)}`;

// Per-cable zap timing. One shared period would make every wire fire on the same
// beat, which reads as a machine pulse rather than arcing current — so each cable
// derives its own period and phase from its id. Hashing the id (rather than
// Math.random) keeps the timing stable across re-renders, so a cable doesn't
// restart its cycle every time an icon moves. The negative delay starts each
// cable partway through its cycle, so they're already out of step on first paint.
function arcTiming(id: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return {
    animationDuration: `${4.5 + (h % 45) / 10}s`, // 4.5s – 8.9s between zaps
    animationDelay: `-${((h >>> 8) % 60) / 10}s`,
  };
}

// A little starburst path centred on a folder: N spokes from an inner to an
// outer radius. Drawn once per zap, flashed out by CSS. Pure geometry.
function spokesPath(c: Point, n = 6, r1 = 6, r2 = 15): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const dx = Math.cos(t), dy = Math.sin(t);
    d += `M ${c.x + dx * r1} ${c.y + dy * r1} L ${c.x + dx * r2} ${c.y + dy * r2} `;
  }
  return d;
}

// The one-shot "zap" drawn when a cable connects (or lands): a bright flash that
// shoots down the cable from the OUT jack to the IN jack, plus a spark burst on
// each folder at the ends. Every element runs its CSS animation once on mount
// (the whole group is only rendered for the ~0.6s the zap lasts), so it plays
// exactly when the wire appears. `a`/`b` are the cable's jack endpoints;
// `from`/`to` are the folder centres where the sparks land.
const ZapFx: React.FC<{ a: Point; b: Point; from: Point; to: Point; shape: WireShape }> = ({ a, b, from, to, shape }) => (
  <g className="wl-zap" style={{ pointerEvents: 'none' }}>
    <path className="wl-zap-run" d={cablePath(a, b, shape)} fill="none" strokeLinecap="round" pathLength={100} />
    {[from, to].map((c, i) => (
      <g key={i}>
        <circle className="wl-ring" cx={c.x} cy={c.y} r={3} />
        <circle className="wl-ring wl-ring2" cx={c.x} cy={c.y} r={3} />
        <path className="wl-spokes" d={spokesPath(c)} fill="none" />
      </g>
    ))}
  </g>
);

// The `: WiresLayerProps` annotation is load-bearing: this project has no
// @types/react installed, so React.FC resolves to `any` and gives the destructured
// props no contextual type — without it, `shape = 'curved'` widens to `string`
// and the WireShape union stops being checked.
export const WiresLayer: React.FC<WiresLayerProps> = ({
  wires,
  nodeIds,
  positions,
  onCreate,
  onRemove,
  shape = 'curved',
  current = 'bolt',
}: WiresLayerProps) => {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = React.useState<{ from: NodeRef; cursor: Point } | null>(null);
  const dragRef = React.useRef(drag);
  dragRef.current = drag;

  // One-shot zap bookkeeping: whenever a wire first appears in `wires`, add its
  // id to `zapping` for ~600ms so the cable renders a ZapFx, then drop it. A ref
  // of the previous id set lets us spot only the freshly-added wires.
  const prevWireIds = React.useRef<Set<string>>(new Set());
  const [zapping, setZapping] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    const cur = new Set<string>(wires.map(wireId));
    const added: string[] = [];
    cur.forEach((id) => { if (!prevWireIds.current.has(id)) added.push(id); });
    prevWireIds.current = cur;
    if (added.length === 0) return;
    setZapping((z) => { const n = new Set(z); added.forEach((id) => n.add(id)); return n; });
    const timers = added.map((id) =>
      setTimeout(() => setZapping((z) => { const n = new Set(z); n.delete(id); return n; }), 600)
    );
    return () => timers.forEach(clearTimeout);
  }, [wires]);

  const anchor = React.useCallback(
    (id: string): Point | null => {
      const p = positions[id];
      return p ? anchorOf(p) : null;
    },
    [positions]
  );

  // Map a screen (client) point into the SVG's own coordinate space. Going
  // through getScreenCTM handles the desktop's zoom transform and any scroll/
  // offset — a plain rect subtraction breaks under zoom (cursor drifts, drops
  // miss), because node anchors live in unzoomed SVG units.
  const localPoint = (e: PointerEvent | React.PointerEvent): Point => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      const o = svg.getBoundingClientRect();
      return { x: e.clientX - o.left, y: e.clientY - o.top };
    }
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  // Nearest wirable node to a point within a grab radius, excluding one node.
  const nodeNear = React.useCallback(
    (p: Point, exclude?: string): string | null => {
      let best: string | null = null;
      let bestD = 46;
      for (const id of nodeIds) {
        if (id === exclude) continue;
        const a = anchor(id);
        if (!a) continue;
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d < bestD) { bestD = d; best = id; }
      }
      return best;
    },
    [nodeIds, anchor]
  );

  const startDrag = (from: NodeRef) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({ from, cursor: localPoint(e) });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (cur) setDrag({ from: cur.from, cursor: localPoint(e) });
    };
    const onUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (cur) {
        const target = nodeNear(localPoint(e), nodeId(cur.from));
        if (target) onCreate(cur.from, parseNode(target));
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, nodeNear, onCreate]);

  const dragTargetId = drag ? nodeNear(drag.cursor, nodeId(drag.from)) : null;
  const order = React.useMemo(() => chainOrder(wires), [wires]);

  // Only draw cables between nodes that are currently wirable/on the desktop —
  // so shelved kinds (playlists, for now) and wires to since-removed icons don't
  // leave dangling noodles.
  const wirableIds = React.useMemo(() => new Set(nodeIds), [nodeIds]);
  const visibleWires = wires.filter((w) => wirableIds.has(nodeId(w.from)) && wirableIds.has(nodeId(w.to)));

  return (
    <svg ref={svgRef} className="absolute inset-0 z-[2] w-full h-full" style={{ pointerEvents: 'none' }}>
      <style>{`
        .wl-cable { stroke: var(--brutal-neon); stroke-width: 1.5; fill: none; transition: stroke-width .12s; }
        .wl-wire:hover .wl-cable { stroke-width: 3; filter: drop-shadow(0 0 3px var(--brutal-neon)); }
        .wl-cut { opacity: 0; transition: opacity .12s; }
        .wl-wire:hover .wl-cut { opacity: 1; }
        .wl-jack { transition: opacity .12s; }
        .wl-jack-out { opacity: .5; cursor: crosshair; }
        .wl-jack-out:hover { opacity: 1; }
        .wl-jack-out:hover .wl-jack-socket { r: 6; }
        .wl-jack-in { opacity: .4; }

        /* Current in a connected cable: NOT a steady stream of dashes (that reads
           as beads on a string). Instead one short bolt arcs down the cable OUT →
           IN, flickering as it goes, then the cable sits dark for the rest of the
           cycle — so a zap is an event you notice, not background texture. The
           sweep happens in the first ~8% of the cycle; the other ~92% is idle.
           Cables carry pathLength=100, so dash units are percent of the cable and
           one bolt travels end to end whatever the cable's real length. Period is
           12+1000=1012, so offset 1012 → 912 walks the bolt the full 100. */
        .wl-arc {
          stroke: #fff; stroke-width: 2.5; fill: none; stroke-linecap: round;
          stroke-dasharray: 12 1000; stroke-dashoffset: 1012; opacity: 0;
          filter: drop-shadow(0 0 5px var(--brutal-neon));
          animation: wl-arc 5s linear infinite;
        }
        @keyframes wl-arc {
          0%    { stroke-dashoffset: 1012; opacity: 0; }
          1%    { opacity: 1; }
          3%    { opacity: .45; }
          4.5%  { opacity: 1; }
          6%    { opacity: .5; }
          7.5%  { opacity: 1; }
          8%    { stroke-dashoffset: 912; opacity: .9; }
          9%    { stroke-dashoffset: 912; opacity: 0; }
          100%  { stroke-dashoffset: 912; opacity: 0; }
        }
        /* The bolt landing on the destination folder — fires as the sweep ends,
           sharing the cable's duration/delay so the two stay in step. */
        .wl-arc-hit {
          fill: none; stroke: var(--brutal-neon); stroke-width: 2; opacity: 0;
          filter: drop-shadow(0 0 4px var(--brutal-neon));
          animation: wl-arc-hit 5s linear infinite;
        }
        @keyframes wl-arc-hit {
          0%, 7% { r: 3px; opacity: 0; }
          8%     { r: 5px; opacity: .9; }
          14%    { r: 18px; opacity: 0; }
          100%   { r: 3px; opacity: 0; }
        }

        /* The live rubber-band while connecting: dashes crawl toward the cursor. */
        .wl-rubber { animation: wl-rubber .5s linear infinite; }
        @keyframes wl-rubber { to { stroke-dashoffset: -10; } }

        /* One-shot zap when a cable connects: a short bright segment sweeps the
           whole cable. Paths carry pathLength=100, so dash units are percent of
           the cable and the sweep works at any cable length. */
        .wl-zap-run {
          stroke: #fff; stroke-width: 3;
          filter: drop-shadow(0 0 6px var(--brutal-neon));
          stroke-dasharray: 10 1000; stroke-dashoffset: 1010;
          animation: wl-zap-run .5s ease-out forwards;
        }
        @keyframes wl-zap-run {
          0%   { stroke-dashoffset: 1010; opacity: 1; }
          85%  { opacity: 1; }
          100% { stroke-dashoffset: 910; opacity: 0; }
        }
        .wl-ring {
          fill: none; stroke: var(--brutal-neon); stroke-width: 2;
          filter: drop-shadow(0 0 4px var(--brutal-neon));
          animation: wl-ring .5s ease-out forwards;
        }
        .wl-ring2 { stroke: #fff; animation-delay: .1s; }
        @keyframes wl-ring { from { r: 3px; opacity: .9; } to { r: 28px; opacity: 0; } }
        .wl-spokes {
          stroke: #fff; stroke-width: 1.5; stroke-linecap: round;
          filter: drop-shadow(0 0 3px var(--brutal-neon));
          animation: wl-spokes .4s ease-out forwards;
        }
        @keyframes wl-spokes { from { opacity: 1; } to { opacity: 0; } }

        @media (prefers-reduced-motion: reduce) {
          .wl-arc, .wl-arc-hit, .wl-zap-run, .wl-ring, .wl-spokes, .wl-rubber { animation: none; }
          .wl-arc, .wl-zap { display: none; }
        }
      `}</style>

      {/* Existing cables: OUT jack of the source → IN jack of the target. */}
      {visibleWires.map((w) => {
        const af = anchor(nodeId(w.from));
        const bt = anchor(nodeId(w.to));
        if (!af || !bt) return null; // an endpoint isn't on the desktop right now
        const a = jackOut(af);
        const b = jackIn(bt);
        const d = cablePath(a, b, shape);
        const mid = cableMid(a, b, shape);
        return (
          <g key={wireId(w)} className="wl-wire">
            <path className="wl-cable" d={d} strokeLinecap="round" />
            {/* Occasional bolt arcing down the connected cable, OUT → IN, and the
                spark where it lands on the destination folder. 'quiet' drops both
                and leaves a static cable — the connect zap below still fires. */}
            {current === 'bolt' && (
              <>
                <path
                  className="wl-arc"
                  d={d}
                  pathLength={100}
                  style={{ pointerEvents: 'none', ...arcTiming(wireId(w)) }}
                />
                <circle
                  className="wl-arc-hit"
                  cx={bt.x}
                  cy={bt.y}
                  r={3}
                  style={{ pointerEvents: 'none', ...arcTiming(wireId(w)) }}
                />
              </>
            )}
            {/* One-shot connect zap: flash down the cable + sparks on both folders. */}
            {zapping.has(wireId(w)) && <ZapFx a={a} b={b} from={af} to={bt} shape={shape} />}
            {/* Fat invisible hit-strip to select/cut. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={() => onRemove(w.from, w.to)}
            >
              <title>CLICK TO CUT</title>
            </path>
            {/* Cut affordance at the midpoint, revealed on hover. */}
            <g className="wl-cut" style={{ pointerEvents: 'none' }}>
              <circle cx={mid.x} cy={mid.y} r={8} fill="var(--brutal-black)" stroke="var(--brutal-neon)" strokeWidth={1.5} />
              <path d={`M ${mid.x - 3} ${mid.y - 3} L ${mid.x + 3} ${mid.y + 3} M ${mid.x + 3} ${mid.y - 3} L ${mid.x - 3} ${mid.y + 3}`} stroke="var(--brutal-neon)" strokeWidth={1.5} strokeLinecap="round" />
            </g>
          </g>
        );
      })}

      {/* Live rubber-band while dragging a new wire: flows out of the source OUT
          jack and follows the cursor EXACTLY (no snapping) — the cursor stands in
          for the far jack, so it still curves like it's flowing toward one. It
          only connects to a real IN jack on release. The target node lights up
          when the cursor is over it, as a hint of where it'll land. */}
      {drag && (() => {
        const af = anchor(nodeId(drag.from));
        if (!af) return null;
        const a = jackOut(af);
        return (
          <path
            d={cablePath(a, drag.cursor, shape)}
            className="wl-cable wl-rubber"
            strokeDasharray="5 5"
            strokeLinecap="round"
            opacity={0.9}
          />
        );
      })()}

      {/* Where the cable will land: highlight the IN jack of the node under the
          cursor (no cable snap, just a target cue). */}
      {drag && dragTargetId && (() => {
        const t = anchor(dragTargetId);
        if (!t) return null;
        const p = jackIn(t);
        return <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="var(--brutal-neon)" strokeWidth={2} style={{ pointerEvents: 'none' }} />;
      })()}

      {/* Number badges: play order, 1 = start. Only on wired nodes. */}
      {nodeIds.map((id) => {
        const n = order.get(id);
        const a = anchor(id);
        if (!n || !a) return null;
        const bx = a.x - 30, by = a.y - 30; // top-left corner of the icon box
        return (
          <g key={`badge-${id}`} style={{ pointerEvents: 'none' }}>
            <rect x={bx} y={by} width={18} height={18} rx={2} fill="var(--brutal-neon)" stroke="var(--brutal-black)" strokeWidth={1.5} />
            <text x={bx + 9} y={by + 13} textAnchor="middle" fontSize={12} fontFamily="monospace" fontWeight="bold" fill="var(--brutal-black)">{n}</text>
          </g>
        );
      })}

      {/* Jacks. IN (hollow ring) on the left edge; OUT (filled socket) on the
          right edge. Drag from an OUT jack to another icon to run a cable. */}
      {nodeIds.map((id) => {
        const a = anchor(id);
        if (!a) return null;
        const out = jackOut(a);
        const inn = jackIn(a);
        return (
          <g key={`jacks-${id}`} className="wl-jack">
            {/* IN — hollow ring, receive end */}
            <g className="wl-jack-in" style={{ pointerEvents: 'none' }}>
              <circle cx={inn.x} cy={inn.y} r={5} fill="var(--brutal-black)" stroke="var(--brutal-neon)" strokeWidth={1.5} />
            </g>
            {/* OUT — filled socket, drag source */}
            <g
              className="wl-jack-out"
              style={{ pointerEvents: 'auto' }}
              onPointerDown={startDrag(parseNode(id))}
            >
              <circle cx={out.x} cy={out.y} r={12} fill="transparent" />
              <circle cx={out.x} cy={out.y} r={7} fill="none" stroke="var(--brutal-neon)" strokeWidth={1} opacity={0.5} />
              <circle className="wl-jack-socket" cx={out.x} cy={out.y} r={4.5} fill="var(--brutal-neon)" stroke="var(--brutal-black)" strokeWidth={1.5} />
              <title>DRAG OUT →</title>
            </g>
          </g>
        );
      })}
    </svg>
  );
};
