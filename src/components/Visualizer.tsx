import React from 'react';
import { BandSmoother, VIZ_BANDS, buildBandRanges, reduceToBands } from '../player/spectrumBands';

/**
 * Every visualizer mode, in cycle order. THE single source of truth: the type,
 * the settings grid, and both cycle handlers all derive from this array, so
 * adding a mode here wires it up everywhere. (It used to be duplicated in four
 * files, where a new mode silently went missing from whichever one you forgot.)
 */
export const VISUALIZER_MODES = [
  'BARS',
  'MIRROR',
  'RADIAL',
  'WATERFALL',
  'OSCILLOSCOPE',
  'BLOCKS',
  'VU',
  'MATRIX',
  'GLITCH',
  'PARTICLES',
  'TERRAIN',
] as const;

export type VisualizerMode = (typeof VISUALIZER_MODES)[number];

/**
 * How much of the previous frame each mode keeps (0 = don't clear at all, 1 =
 * wipe to black). Typed as a full Record so a new mode fails to compile until it
 * declares one — the alternative is a mode that inherits a wrong trail and looks
 * broken for reasons that are hard to trace back to here.
 */
const TRAIL_ALPHA: Record<VisualizerMode, number> = {
  BARS: 0.32,
  MIRROR: 0.32,
  // Scrolls its own history by blitting the canvas onto itself; any clear at all
  // would erase the very thing it's drawing.
  WATERFALL: 0,
  RADIAL: 0.22,
  OSCILLOSCOPE: 0.32,
  BLOCKS: 0.32,
  // Chunky solid segments — trails just smear them into mud.
  VU: 1,
  // Long trails ARE the effect.
  MATRIX: 0.14,
  GLITCH: 0.32,
  PARTICLES: 0.32,
  TERRAIN: 0.32,
};

/**
 * Streamed spectrum bytes for windows that DON'T hold the AnalyserNode (client
 * windows, once the engine lives in another process). A STABLE container whose
 * arrays are mutated in place by the frame subscriber — never replaced — so the
 * draw loop reads the latest bytes each frame without re-rendering this memo'd
 * component. `frequency` holds VIZ_BANDS log-spaced bands (already reduced by the
 * engine), NOT raw FFT bins; the host path reduces its own bins to the same shape
 * so both sources feed identical data into the smoother below.
 */
export interface VisualizerFrames {
  frequency: Uint8Array;
  timeDomain: Uint8Array;
}

interface VisualizerProps {
  isPlaying: boolean;
  mode: VisualizerMode;
  analyser: AnalyserNode | null;
  /** Fallback spectrum source when there's no local analyser. */
  frames?: VisualizerFrames | null;
  onTogglePlay?: () => void;
}

// 60fps. The envelope follower in BandSmoother is tuned per-frame, and at 30 the
// decay reads as a visible stutter rather than a fall. The canvas is capped at
// MAX_CANVAS_DIM so the per-frame pixel cost stays bounded either way.
const FRAME_INTERVAL = 1000 / 60;
// Cap the canvas backing store so a maximized / hi-DPI window doesn't redraw
// millions of pixels per frame. CSS stretches it to fill; softness is invisible
// under the 40%-opacity backdrop.
const MAX_CANVAS_DIM = 1280;

/** Hex color + 0..1 alpha -> rgba(). Avoids the string-concat alpha hack. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full || '00FF00', 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Parse #rgb / #rrggbb into [r, g, b], falling back to green on garbage. */
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0, 255, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend two hex colors, t = 0 gives `a`, t = 1 gives `b`. Used for heat ramps. */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(ar + (br - ar) * k)}, ${Math.round(ag + (bg - ag) * k)}, ${Math.round(ab + (bb - ab) * k)})`;
}

export const Visualizer = React.memo(({ isPlaying, mode, analyser, frames = null, onTogglePlay }: VisualizerProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const requestRef = React.useRef<number>(0);
  const colorsRef = React.useRef({ neon: '#00FF00', white: '#FFFFFF' });
  const particlesRef = React.useRef<Array<{x: number, y: number, vx: number, vy: number, life: number, maxLife: number, size: number}>>([]);
  const terrainOffsetRef = React.useRef<number>(0);
  // Per-instance scratch for the modes that carry state between frames. These
  // are refs rather than module-level buffers so two visualizers in one document
  // (desktop STAGE + an in-document stage panel) can't scribble on each other.
  const terrainBufRef = React.useRef<Float32Array>(new Float32Array(0));
  const radialSpinRef = React.useRef<number>(0);
  const vuPeaksRef = React.useRef<Float32Array>(new Float32Array(3));
  const matrixRef = React.useRef<{ cols: number; y: Float32Array; speed: Float32Array }>({
    cols: 0,
    y: new Float32Array(0),
    speed: new Float32Array(0),
  });
  // Reused across frames so the draw loop allocates no garbage. `raw` holds the
  // analyser's linear bins (host path only); `bands` holds the log-spaced
  // reduction that every mode actually draws from.
  const rawRef = React.useRef<Uint8Array>(new Uint8Array(0));
  const bandsRef = React.useRef<Uint8Array>(new Uint8Array(VIZ_BANDS));
  const timeRef = React.useRef<Uint8Array>(new Uint8Array(0));
  const rangesRef = React.useRef<Int32Array | null>(null);
  const smootherRef = React.useRef<BandSmoother>(new BandSmoother(VIZ_BANDS));
  const lastDrawRef = React.useRef<number>(0);

  // Update colors when theme might have changed
  React.useEffect(() => {
    const updateColors = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      colorsRef.current = {
        neon: rootStyle.getPropertyValue('--brutal-neon').trim() || '#00FF00',
        white: rootStyle.getPropertyValue('--brutal-white').trim() || '#FFFFFF'
      };
    };

    updateColors();

    // Listen for theme changes on style or class attribute
    const observer = new MutationObserver(() => {
      updateColors();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    return () => observer.disconnect();
  }, []);

  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setIsVisible(entry.isIntersecting);
      }
    }, { threshold: 0.1 });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const draw = React.useCallback((now?: number) => {
    // Returning without scheduling stops the loop; the play/visibility effect
    // restarts it. That's how the visualizer parks itself when off-screen.
    // Either a local analyser (engine host) or streamed frames (client) drives it.
    if (!canvasRef.current || (!analyser && !frames) || !isVisible) return;

    // Throttle to FRAME_INTERVAL while still riding the display's vsync cadence.
    const t = typeof now === 'number' ? now : performance.now();
    if (t - lastDrawRef.current < FRAME_INTERVAL) {
      requestRef.current = requestAnimationFrame(draw);
      return;
    }
    lastDrawRef.current = t;

    // Ensure context is running (analyser path only — a client has no context).
    if (analyser && analyser.context.state === 'suspended' && 'resume' in analyser.context) {
      (analyser.context as AudioContext).resume();
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bands = bandsRef.current;

    // ── Fill `bands` (log-spaced, 0..255) from whichever source is active ──────
    if (analyser) {
      const binCount = analyser.frequencyBinCount;
      if (rawRef.current.length !== binCount) {
        rawRef.current = new Uint8Array(binCount);
        rangesRef.current = buildBandRanges(binCount, analyser.context.sampleRate, VIZ_BANDS);
      }
      analyser.getByteFrequencyData(rawRef.current);
      reduceToBands(rawRef.current, rangesRef.current!, bands);
    } else {
      bands.set(frames!.frequency.subarray(0, Math.min(bands.length, frames!.frequency.length)));
    }

    // Time-domain is only read by OSCILLOSCOPE; skip the copy for other modes.
    let timeData = timeRef.current;
    if (mode === 'OSCILLOSCOPE') {
      const timeLen = analyser ? analyser.fftSize : frames!.timeDomain.length;
      if (timeData.length !== timeLen) {
        timeData = new Uint8Array(timeLen);
        timeRef.current = timeData;
      }
      if (analyser) analyser.getByteTimeDomainData(timeData);
      else timeData.set(frames!.timeDomain);
    }

    const smoother = smootherRef.current;
    smoother.update(bands);
    const levels = smoother.levels;
    const peaks = smoother.peaks;
    const n = levels.length;

    const width = canvas.width;
    const height = canvas.height;
    const { neon: neonColor, white: whiteColor } = colorsRef.current;

    // Energy split, used by the reactive modes. Bands are log-spaced, so these
    // slices really are bass / mid / treble rather than arbitrary thirds.
    let bass = 0, mid = 0, high = 0;
    const third = Math.floor(n / 3);
    for (let i = 0; i < third; i++) bass += levels[i];
    for (let i = third; i < third * 2; i++) mid += levels[i];
    for (let i = third * 2; i < n; i++) high += levels[i];
    bass /= third; mid /= third; high /= (n - third * 2);
    const energy = (bass + mid + high) / 3;

    // Clear canvas. Trails are shorter now that we run at 60fps — the old 0.2
    // alpha at 30fps left smears that muddied everything into a green fog.
    const trail = TRAIL_ALPHA[mode];
    if (trail > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${trail})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Only meaningful for modes that clear each frame; on WATERFALL it would
    // burn a permanent stripe into the scrolling history.
    if (energy < 0.001 && isPlaying && trail > 0) {
      // Draw a faint static line to show it's alive
      ctx.strokeStyle = withAlpha(whiteColor, 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }

    if (mode === 'BARS') {
      // One bar per log band across the full width, with a fixed gap. Bars now
      // reach the top on loud material because the band values are gain-tilted.
      const slot = width / n;
      const gap = Math.max(1, slot * 0.18);
      const barW = Math.max(1, slot - gap);
      const floor = height;

      // Vertical gradient built once per frame, not per bar.
      const grad = ctx.createLinearGradient(0, floor, 0, 0);
      grad.addColorStop(0, withAlpha(neonColor, 0.45));
      grad.addColorStop(0.55, neonColor);
      grad.addColorStop(1, whiteColor);

      ctx.shadowBlur = 12 + energy * 24;
      ctx.shadowColor = neonColor;
      ctx.fillStyle = grad;

      for (let i = 0; i < n; i++) {
        const h = levels[i] * height;
        if (h < 1) continue;
        ctx.fillRect(i * slot, floor - h, barW, h);
      }
      ctx.shadowBlur = 0;

      // Falling peak caps — the detail that makes a spectrum read as a spectrum.
      ctx.fillStyle = whiteColor;
      for (let i = 0; i < n; i++) {
        const py = floor - peaks[i] * height;
        if (peaks[i] < 0.01) continue;
        ctx.fillRect(i * slot, py - 2, barW, 2);
      }
    } else if (mode === 'MIRROR') {
      // BARS folded about the horizontal centre line, with a dimmer "reflection"
      // below. Reads as a single organism rather than a row of columns.
      const slot = width / n;
      const gap = Math.max(1, slot * 0.18);
      const barW = Math.max(1, slot - gap);
      const midY = height / 2;
      const reach = height * 0.46;

      ctx.shadowBlur = 10 + energy * 20;
      ctx.shadowColor = neonColor;
      for (let i = 0; i < n; i++) {
        const h = levels[i] * reach;
        if (h < 1) continue;
        const x = i * slot;
        ctx.fillStyle = neonColor;
        ctx.fillRect(x, midY - h, barW, h);
        // The reflection is shorter and fainter — a mirror, not a rotation.
        ctx.fillStyle = withAlpha(neonColor, 0.32);
        ctx.fillRect(x, midY, barW, h * 0.62);
      }
      ctx.shadowBlur = 0;

      ctx.fillStyle = whiteColor;
      for (let i = 0; i < n; i++) {
        if (peaks[i] < 0.01) continue;
        ctx.fillRect(i * slot, midY - peaks[i] * reach - 2, barW, 2);
      }

      ctx.fillStyle = withAlpha(whiteColor, 0.22);
      ctx.fillRect(0, midY, width, 1);
    } else if (mode === 'RADIAL') {
      // The spectrum wrapped around a circle: bass at the 3 o'clock position,
      // treble sweeping back round to it. Rotates faster the louder it gets, so
      // the whole field turns with the track instead of sitting still.
      const cx = width / 2;
      const cy = height / 2;
      const r0 = Math.min(width, height) * 0.13;
      const reach = Math.min(width, height) * 0.34;
      radialSpinRef.current += 0.0015 + energy * 0.007;
      const spin = radialSpinRef.current;
      const step = (Math.PI * 2) / n;

      // One path for every spoke: a single stroke call instead of n of them.
      ctx.lineWidth = Math.max(1.5, r0 * step * 0.85);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = neonColor;
      ctx.shadowBlur = 10 + energy * 22;
      ctx.shadowColor = neonColor;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const len = levels[i] * reach;
        if (len < 1) continue;
        const a = spin + i * step;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Peak dots orbiting outside the spokes.
      ctx.fillStyle = whiteColor;
      for (let i = 0; i < n; i++) {
        if (peaks[i] < 0.02) continue;
        const a = spin + i * step;
        const r = r0 + peaks[i] * reach;
        ctx.fillRect(cx + Math.cos(a) * r - 1.5, cy + Math.sin(a) * r - 1.5, 3, 3);
      }

      // Inner ring breathing on bass.
      ctx.strokeStyle = withAlpha(whiteColor, 0.25 + bass * 0.6);
      ctx.lineWidth = 1 + bass * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * (0.9 + bass * 0.25), 0, Math.PI * 2);
      ctx.stroke();
    } else if (mode === 'WATERFALL') {
      // A scrolling spectrogram: frequency across, time down, level as heat.
      // Scrolled by blitting the canvas onto itself one strip up, which is far
      // cheaper than keeping and redrawing a history buffer.
      const SPEED = 2;
      ctx.drawImage(canvas, 0, -SPEED);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, height - SPEED, width, SPEED);

      const slot = width / n;
      for (let i = 0; i < n; i++) {
        const v = levels[i];
        if (v < 0.02) continue;
        // Cold -> hot: dim neon through full neon into white at the top end.
        ctx.fillStyle = v < 0.62
          ? withAlpha(neonColor, 0.15 + (v / 0.62) * 0.85)
          : mixHex(neonColor, whiteColor, (v - 0.62) / 0.38);
        ctx.fillRect(i * slot, height - SPEED, Math.ceil(slot), SPEED);
      }

      // A baseline so the display still reads as an instrument when it's quiet.
      ctx.fillStyle = withAlpha(whiteColor, 0.1);
      ctx.fillRect(0, height - 1, width, 1);
    } else if (mode === 'VU') {
      // Three segmented meters. Deliberately the least "spectrum-like" mode:
      // big, blunt, readable across a room.
      const labels = ['BASS', 'MID', 'TREBLE'];
      const values = [bass, mid, high];
      const vuPeaks = vuPeaksRef.current;
      const SEGS = 28;
      const rowH = height / 3.4;
      const padY = rowH * 0.22;
      const labelW = Math.min(96, width * 0.16);
      const trackX = labelW + 8;
      const trackW = Math.max(8, width - trackX - 8);
      const segW = trackW / SEGS;

      ctx.font = `bold ${Math.max(10, Math.round(rowH * 0.22))}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      for (let m = 0; m < 3; m++) {
        const v = values[m];
        const top = m * rowH + padY;
        const barH = rowH - padY * 2;
        const cy = top + barH / 2;

        // Peak marker falls slowly so you can read the last transient.
        vuPeaks[m] = v >= vuPeaks[m] ? v : Math.max(v, vuPeaks[m] - 0.006);

        ctx.fillStyle = withAlpha(whiteColor, 0.55);
        ctx.fillText(labels[m], 6, cy);

        const lit = Math.round(v * SEGS);
        for (let s = 0; s < SEGS; s++) {
          const frac = s / SEGS;
          if (s < lit) {
            // Redline the top segments white, like a real meter.
            ctx.fillStyle = frac > 0.85 ? whiteColor : withAlpha(neonColor, 0.55 + frac * 0.45);
          } else {
            ctx.fillStyle = withAlpha(whiteColor, 0.07);
          }
          ctx.fillRect(trackX + s * segW + 1, top, Math.max(1, segW - 2), barH);
        }

        const ps = Math.min(SEGS - 1, Math.round(vuPeaks[m] * SEGS));
        if (vuPeaks[m] > 0.02) {
          ctx.fillStyle = whiteColor;
          ctx.fillRect(trackX + ps * segW + 1, top, Math.max(1, segW - 2), barH);
        }
      }
    } else if (mode === 'MATRIX') {
      // Falling glyph columns whose speed and brightness track the band sitting
      // at that column's x position, so the rain literally falls in time.
      const colW = 18;
      const cols = Math.max(1, Math.floor(width / colW));
      const st = matrixRef.current;
      if (st.cols !== cols) {
        st.cols = cols;
        st.y = new Float32Array(cols);
        st.speed = new Float32Array(cols);
        for (let c = 0; c < cols; c++) st.y[c] = Math.random() * height;
      }

      const TRAIL = 5;
      const glyphs = 'アイウエオカキクケコサシスセソ0123456789<>[]{}/\\=+*#$%';
      ctx.font = `${colW - 4}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let c = 0; c < cols; c++) {
        const level = levels[Math.floor((c / cols) * n)];
        st.speed[c] = 1.2 + level * 9;
        st.y[c] += st.speed[c];
        if (st.y[c] > height + TRAIL * colW) st.y[c] = -Math.random() * height * 0.35;

        const x = c * colW + colW / 2;
        // Head glyph burns white, the trail fades back through neon.
        for (let t = 0; t < TRAIL; t++) {
          const gy = st.y[c] - t * colW;
          if (gy < -colW || gy > height + colW) continue;
          const g = glyphs[(Math.random() * glyphs.length) | 0];
          ctx.fillStyle = t === 0
            ? withAlpha(whiteColor, 0.75 + level * 0.25)
            : withAlpha(neonColor, (1 - t / TRAIL) * (0.35 + level * 0.65));
          ctx.fillText(g, x, gy);
        }
      }
      ctx.textBaseline = 'alphabetic';
    } else if (mode === 'OSCILLOSCOPE') {
      const len = timeData.length;
      // Start the trace at a rising zero-crossing so the waveform is anchored
      // instead of sliding sideways every frame like an untriggered scope.
      let start = 0;
      for (let i = 1; i < len / 2; i++) {
        if (timeData[i - 1] < 128 && timeData[i] >= 128) { start = i; break; }
      }
      const count = len - start;
      const sliceWidth = width / count;

      // Glow pass then a crisp core pass — cheap, and it reads as CRT phosphor.
      for (const pass of [0, 1]) {
        ctx.beginPath();
        ctx.lineWidth = pass === 0 ? 10 : 2.5;
        ctx.strokeStyle = pass === 0 ? withAlpha(neonColor, 0.18) : neonColor;
        ctx.lineJoin = 'round';
        for (let i = 0; i < count; i++) {
          const v = (timeData[start + i] - 128) / 128;
          const x = i * sliceWidth;
          const y = height / 2 + v * height * 0.42;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (mode === 'BLOCKS') {
      const blockSize = 16;
      const cols = Math.max(1, Math.floor(width / blockSize));
      const rows = Math.max(1, Math.floor(height / blockSize));

      for (let i = 0; i < cols; i++) {
        const level = levels[Math.floor((i / cols) * n)];
        const activeRows = Math.floor(level * rows);

        for (let j = 0; j < activeRows; j++) {
          // Top blocks of each column burn white-hot; the stack below cools off.
          const ratio = j / rows;
          ctx.fillStyle = j === activeRows - 1 ? whiteColor : withAlpha(neonColor, 0.4 + ratio * 0.6);
          ctx.fillRect(i * blockSize + 1, (rows - j - 1) * blockSize + 1, blockSize - 2, blockSize - 2);
        }
      }
    } else if (mode === 'GLITCH') {
      // Slice displacement driven by treble, so the tearing lands on hi-hats and
      // snares instead of firing at random like the old Math.random() spray.
      const intensity = Math.max(0, high - 0.18) * 2;
      if (intensity > 0.02) {
        const slices = Math.floor(intensity * 14) + 1;
        for (let i = 0; i < slices; i++) {
          const sy = Math.random() * height;
          const sh = Math.random() * 24 * intensity + 2;
          const dx = (Math.random() - 0.5) * width * 0.35 * intensity;
          ctx.drawImage(canvas, 0, sy, width, sh, dx, sy, width, sh);
        }
      }

      // Chromatic-ish edge bars pumping on bass.
      if (bass > 0.25) {
        const barH = bass * height * 0.5;
        ctx.fillStyle = withAlpha(neonColor, 0.35);
        ctx.fillRect(0, height / 2 - barH / 2, width, 2);
        ctx.fillStyle = withAlpha(whiteColor, 0.25);
        ctx.fillRect(0, height / 2 + barH / 2, width, 2);
      }

      ctx.font = 'bold 40px "Space Grotesk"';
      ctx.fillStyle = withAlpha(whiteColor, 0.05 + high * 0.25);
      ctx.textAlign = 'center';
      ctx.fillText('SIGNAL_LOSS', width / 2 + (Math.random() - 0.5) * high * 40, height / 2);
    } else if (mode === 'PARTICLES') {
      // Emit on bass transients rather than every frame above a threshold, so
      // particles burst on kicks instead of streaming continuously.
      if (bass > 0.2) {
        const numToSpawn = Math.floor(bass * 6);
        for (let i = 0; i < numToSpawn; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = (1 + bass * 8) * (0.5 + Math.random());
          particlesRef.current.push({
            x: width / 2,
            y: height / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            maxLife: Math.random() * 0.5 + 0.5,
            size: Math.random() * 3 + 1
          });
        }
      }

      // Update and draw particles, compacting in place so no array is allocated.
      const list = particlesRef.current;
      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985; // drag, so bursts bloom and settle
        p.vy *= 0.985;
        p.life -= 0.014 / p.maxLife;

        if (p.life > 0) {
          list[write++] = p;
          ctx.fillStyle = withAlpha(p.life > 0.7 ? whiteColor : neonColor, p.life);
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
      list.length = write;

      // Center ring pulsing on overall energy.
      const radius = Math.min(width, height) * (0.1 + energy * 0.22);
      ctx.strokeStyle = withAlpha(whiteColor, 0.35 + energy * 0.65);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mode === 'TERRAIN') {
      // Scroll a history buffer instead of index-shifting the live spectrum. The
      // old version reused the current frame for every row, so the "landscape"
      // was the same ridge repeated — it never actually travelled.
      const rows = 16;
      const cols = n;
      if (terrainBufRef.current.length !== rows * cols) {
        terrainBufRef.current = new Float32Array(rows * cols);
      }
      const hist = terrainBufRef.current;
      terrainOffsetRef.current = (terrainOffsetRef.current + 1) % rows;
      const head = terrainOffsetRef.current;
      for (let x = 0; x < cols; x++) hist[head * cols + x] = levels[x];

      ctx.lineWidth = 1;
      const horizon = height * 0.28;

      for (let r = 0; r < rows; r++) {
        // r = 0 is the newest row, drawn nearest the viewer.
        const rowIdx = (head - r + rows * 2) % rows;
        const depth = r / rows;              // 0 near -> 1 far
        const persp = 1 - depth * 0.72;      // narrows toward the horizon
        const rowY = height - (height - horizon) * Math.pow(depth, 0.8);

        ctx.strokeStyle = withAlpha(neonColor, (1 - depth) * 0.9 + 0.08);
        ctx.beginPath();
        for (let x = 0; x < cols; x++) {
          const px = width / 2 + (x / (cols - 1) - 0.5) * width * persp;
          const py = rowY - hist[rowIdx * cols + x] * height * 0.3 * persp;
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    requestRef.current = requestAnimationFrame(draw);
  }, [analyser, frames, mode, isVisible, isPlaying]);

  // Wipe on mode switch. Modes with TRAIL_ALPHA 0 (WATERFALL) never clear, so
  // without this they scroll the OUTGOING mode's last frame through their
  // history — switching from RADIAL left a donut drifting up the spectrogram.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [mode]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: cssW, height: cssH } = entry.contentRect;
        // Draw at a capped resolution; CSS stretches the canvas to fill. Keeps
        // per-frame pixel work bounded regardless of window size or DPI.
        const scale = Math.min(1, MAX_CANVAS_DIM / Math.max(cssW, cssH || 1));
        const width = Math.max(1, Math.round(cssW * scale));
        const height = Math.max(1, Math.round(cssH * scale));
        canvas.width = width;
        canvas.height = height;

        // Redraw immediately if not playing to avoid flicker
        if (!isPlaying) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();
          }
        }
      }
    });

    observer.observe(parent);
    return () => observer.disconnect();
  }, [isPlaying]);

  React.useEffect(() => {
    if (isPlaying && (analyser || frames) && isVisible) {
      requestRef.current = requestAnimationFrame(draw);
    } else {
      cancelAnimationFrame(requestRef.current);
      // Drop the envelope state so the next play starts from silence rather than
      // snapping in from wherever the last track left the bars.
      smootherRef.current.reset();
      particlesRef.current.length = 0;
      vuPeaksRef.current.fill(0);
      // Clear canvas when stopped
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, canvasRef.current.height / 2);
          ctx.lineTo(canvasRef.current.width, canvasRef.current.height / 2);
          ctx.stroke();
        }
      }
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isPlaying, analyser, frames, draw, isVisible]);

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-brutal-black cursor-pointer group/viz"
      onClick={onTogglePlay}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="font-mono text-[10px] text-brutal-white/20 uppercase tracking-[0.5em] group-hover/viz:text-brutal-neon transition-colors">
            STANDBY_MODE // CLICK_TO_PLAY
          </div>
        </div>
      )}
      {isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover/viz:opacity-100 transition-opacity">
          <div className="font-mono text-[10px] text-brutal-neon uppercase tracking-[0.5em]">
            CLICK_TO_PAUSE
          </div>
        </div>
      )}
    </div>
  );
});
