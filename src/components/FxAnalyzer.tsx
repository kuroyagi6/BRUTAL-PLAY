import React from 'react';
import { usePlayer } from '../player/PlayerContext';
import { eqCurve, logFrequencies, type EqBands } from '../audio/eqCurve';
import { BandSmoother, VIZ_BANDS, buildBandRanges, reduceToBands } from '../player/spectrumBands';

/** Vertical range of the dB scale. ±12 is the EQ's range, +3 of headroom. */
const DB_RANGE = 15;
const F_MIN = 30;
const F_MAX = 16000;
/** Curve resolution. 128 points is smooth at any panel width and costs nothing. */
const CURVE_POINTS = 128;
/** ~30fps. The curve only moves when a slider does; the bars carry the motion. */
const FRAME_INTERVAL = 1000 / 30;

const HZ_TICKS = [50, 100, 500, 1000, 5000, 10000];
const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}K` : `${hz}`);

const logX = (hz: number, width: number) =>
  ((Math.log(hz) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN))) * width;

/**
 * The FX rack's analyzer: the live spectrum with the EQ's actual response curve
 * drawn over it.
 *
 * The curve is computed (src/audio/eqCurve.ts), not measured off the filter
 * nodes, so it is correct while nothing is playing — the rack is most often
 * open with the music paused, and an empty panel would make the wide layout
 * pointless. The bars need a running AudioContext and simply don't draw until
 * there is one.
 */
export function FxAnalyzer({ compact = false }: { compact?: boolean }) {
  const { analyser, eq, distortion, reverb, delay, stereoWidth } = usePlayer();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rafRef = React.useRef<number | null>(null);
  const lastDrawRef = React.useRef(0);

  const rawRef = React.useRef<Uint8Array>(new Uint8Array(0));
  const rangesRef = React.useRef<Int32Array | null>(null);
  const bandsRef = React.useRef<Uint8Array>(new Uint8Array(VIZ_BANDS));
  const smootherRef = React.useRef<BandSmoother>(new BandSmoother(VIZ_BANDS));

  // The frequency axis and the curve only change when the EQ does, so they are
  // computed here and read by the (much hotter) draw loop.
  const freqs = React.useMemo(() => logFrequencies(CURVE_POINTS, F_MIN, F_MAX), []);
  const curve = React.useMemo(
    () => eqCurve(eq as EqBands, freqs, analyser?.context.sampleRate ?? 44100),
    [eq, freqs, analyser]
  );
  const curveRef = React.useRef(curve);
  curveRef.current = curve;

  /** One full repaint. Separate from the loop so it can also be called
   *  directly — see the effects below. */
  const render = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match the backing store to the CSS box so nothing is blurry on HiDPI.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const style = getComputedStyle(canvas);
    const ink = style.getPropertyValue('--brutal-white').trim() || '#E8E2D0';
    const accent = style.getPropertyValue('--brutal-accent').trim() || '#C1272D';
    const spray = style.getPropertyValue('--brutal-spray').trim() || '#7CFF3D';

    const padL = compact ? 0 : 26;
    const padB = compact ? 0 : 16;
    const padT = 6;
    const w = Math.max(1, cssW - padL);
    const h = Math.max(1, cssH - padB - padT);
    const yFor = (db: number) => padT + h / 2 - (db / DB_RANGE) * (h / 2);

    ctx.save();
    ctx.translate(padL, 0);

    // ── Grid ────────────────────────────────────────────────────────────────
    ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (const db of [12, 6, 0, -6, -12]) {
      const y = yFor(db);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = db === 0 ? 0.45 : 0.14;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (!compact) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = ink;
        ctx.textAlign = 'right';
        ctx.fillText(db > 0 ? `+${db}` : `${db}`, -4, y);
      }
    }
    for (const hz of HZ_TICKS) {
      const x = logX(hz, w);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + h);
      ctx.stroke();
      if (!compact) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.fillText(hzLabel(hz), x, padT + h + 8);
      }
    }
    ctx.globalAlpha = 1;

    // ── Spectrum bars ───────────────────────────────────────────────────────
    if (analyser) {
      const binCount = analyser.frequencyBinCount;
      if (rawRef.current.length !== binCount) {
        rawRef.current = new Uint8Array(binCount);
        rangesRef.current = buildBandRanges(binCount, analyser.context.sampleRate, VIZ_BANDS);
      }
      analyser.getByteFrequencyData(rawRef.current);
      reduceToBands(rawRef.current, rangesRef.current!, bandsRef.current);
      smootherRef.current.update(bandsRef.current);

      const levels = smootherRef.current.levels;
      const barW = w / levels.length;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < levels.length; i++) {
        const barH = levels[i] * h;
        ctx.fillRect(i * barW, padT + h - barH, Math.max(1, barW - 1), barH);
      }
      ctx.globalAlpha = 1;
    }

    // ── EQ response curve ───────────────────────────────────────────────────
    const c = curveRef.current;
    const pointX = (i: number) => logX(freqs[i], w);
    ctx.beginPath();
    ctx.moveTo(pointX(0), yFor(c[0]));
    for (let i = 1; i < c.length; i++) ctx.lineTo(pointX(i), yFor(c[i]));

    // Shade between the curve and unity so cuts and boosts read at a glance.
    ctx.save();
    ctx.lineTo(pointX(c.length - 1), yFor(0));
    ctx.lineTo(pointX(0), yFor(0));
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(pointX(0), yFor(c[0]));
    for (let i = 1; i < c.length; i++) ctx.lineTo(pointX(i), yFor(c[i]));
    ctx.strokeStyle = accent;
    ctx.lineWidth = compact ? 2 : 3;
    ctx.stroke();

    // Drive isn't a frequency curve, so it gets a hatched ceiling rather than a
    // fake bump — it says "the signal is being shaped up here" without lying
    // about where.
    if (distortion > 0) {
      ctx.strokeStyle = spray;
      ctx.globalAlpha = 0.35 + (distortion / 100) * 0.4;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const y = padT + 2 + (1 - distortion / 100) * 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [analyser, distortion, compact, freqs]);

  const loop = React.useCallback((now: number) => {
    if (now - lastDrawRef.current >= FRAME_INTERVAL) {
      lastDrawRef.current = now;
      render();
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [render]);

  React.useEffect(() => {
    // Paint once up front. rAF does not fire while the window is hidden or
    // occluded, and the EQ curve is static information that must be on screen
    // the moment the panel opens — waiting for a frame would show an empty box.
    render();
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [render, loop]);

  // Slider moves must redraw even when the animation loop is parked (paused
  // playback still has no frames scheduled if the window is in the background).
  React.useEffect(() => { render(); }, [curve, distortion, render]);

  // The panel is resized by the window manager, not the viewport, so a resize
  // never triggers a React render on its own.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => render());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [render]);

  const tags: string[] = [];
  if (reverb > 0) tags.push(`REVERB ${reverb}`);
  if (delay > 0) tags.push(`DELAY ${delay}`);
  if (stereoWidth !== 100) tags.push(`WIDTH ${stereoWidth}`);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {!compact && (
        <div className="absolute top-2 right-2 flex flex-wrap justify-end gap-1 pointer-events-none">
          {!analyser && (
            <span className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/30 border border-brutal-white/20 px-1.5 py-0.5">
              NO_SIGNAL // CURVE_ONLY
            </span>
          )}
          {tags.map((tag) => (
            <span
              key={tag}
              className="font-mono text-[9px] uppercase tracking-widest bg-brutal-neon text-[var(--brutal-on-accent)] px-1.5 py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
