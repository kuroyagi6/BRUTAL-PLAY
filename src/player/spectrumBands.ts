// Pure spectrum shaping for the visualizer. No React/DOM/Electron.
//
// WHY THIS EXISTS: getByteFrequencyData returns LINEARLY spaced bins. With
// fftSize 1024 @ 44.1kHz each bin is ~43Hz, so bins 0..12 cover the entire bass
// register and bins 200..511 cover 8k-22k, which in real music is near-silent.
// Drawn one-bar-per-bin that reads as "loud mush on the left, dead flat right".
//
// Hearing is logarithmic, so we bucket the linear bins into log-spaced BANDS
// between F_MIN and F_MAX. Every band then carries roughly equal perceptual
// weight and the whole width of the canvas stays alive.
//
// Run the tests with: npx tsx src/player/spectrumBands.test.ts

/** Number of log-spaced bands the raw FFT is reduced to. Also the wire size. */
export const VIZ_BANDS = 64;

/** Below this is subsonic rumble, above it is hiss — neither is worth drawing. */
const F_MIN = 30;
const F_MAX = 16000;

/**
 * Bin ranges for each band, flattened as [start0, end0, start1, end1, ...] with
 * end exclusive. Every band is guaranteed at least one bin (the low bands would
 * otherwise collide onto the same bin and render as gaps).
 */
export function buildBandRanges(
  binCount: number,
  sampleRate: number,
  bands: number = VIZ_BANDS
): Int32Array {
  const ranges = new Int32Array(bands * 2);
  // Hz per bin: the FFT covers 0..sampleRate/2 across binCount bins.
  const hzPerBin = sampleRate / 2 / binCount;
  const logMin = Math.log(F_MIN);
  const logMax = Math.log(Math.min(F_MAX, sampleRate / 2));
  let cursor = 0;

  for (let b = 0; b < bands; b++) {
    const hi = Math.exp(logMin + ((b + 1) / bands) * (logMax - logMin));
    let end = Math.min(binCount, Math.round(hi / hzPerBin));
    // Force forward progress so no band is empty and none runs past the array.
    const start = Math.min(cursor, binCount - 1);
    if (end <= start) end = start + 1;
    if (end > binCount) end = binCount;
    ranges[b * 2] = start;
    ranges[b * 2 + 1] = end;
    cursor = end;
  }
  return ranges;
}

/**
 * Collapse raw FFT bytes into per-band values, writing into `out`.
 *
 * Uses the PEAK of each band, not the mean. A band spanning 300 bins would have
 * its one loud cymbal transient averaged into nothing; peak keeps the transient,
 * which is what makes the display track the music instead of drifting.
 */
export function reduceToBands(fft: Uint8Array, ranges: Int32Array, out: Uint8Array): void {
  const bands = out.length;
  for (let b = 0; b < bands; b++) {
    const start = ranges[b * 2];
    const end = ranges[b * 2 + 1];
    let peak = 0;
    for (let i = start; i < end; i++) {
      if (fft[i] > peak) peak = fft[i];
    }
    out[b] = peak;
  }
}

/**
 * Per-band envelope follower with falling peak caps.
 *
 * Raw band values jitter frame to frame because the FFT is noisy. Rising fast
 * (ATTACK) keeps hits punchy while falling slow (DECAY) gives the pumping motion
 * that reads as "in time with the music". The caps float above and fall under
 * gravity, so you can still see where a transient reached after it dropped.
 *
 * Values are kept as 0..1 floats, not bytes, so slow decay doesn't quantize into
 * visible stair-steps.
 */
export class BandSmoother {
  readonly levels: Float32Array;
  readonly peaks: Float32Array;
  private readonly velocities: Float32Array;

  /** Fraction of the remaining gap closed per frame when rising. */
  private static readonly ATTACK = 0.55;
  /** Fraction of the remaining gap closed per frame when falling. */
  private static readonly DECAY = 0.09;
  /** Downward acceleration applied to a peak cap, in units/frame². */
  private static readonly GRAVITY = 0.0016;
  /** Contrast exponent. See update(). */
  static readonly CURVE = 1.6;

  constructor(bands: number = VIZ_BANDS) {
    this.levels = new Float32Array(bands);
    this.peaks = new Float32Array(bands);
    this.velocities = new Float32Array(bands);
  }

  /**
   * Advance one frame from raw band bytes.
   *
   * `curve` shapes contrast: >1 pushes mid-level bands DOWN, so peaks stay
   * meaningful instead of everything saturating into a solid green rectangle.
   *
   * NO high-frequency gain tilt is applied, which is counterintuitive — music
   * really does roll off ~6dB/octave. It isn't needed because reduceToBands
   * takes the PEAK of each band, and the high bands span ~50 bins each, so their
   * peak already lands near the top of the distribution. Measured against a real
   * AnalyserNode fed pink noise, adding a tilt on top pushed mean bar height to
   * 78-92% — a filled block. Don't re-add one without re-measuring.
   *
   * TUNING TARGET: mean bar height ~40-55% with the loudest bands near 100%.
   * Much above and the display is a rectangle; much below and it's the stubby
   * mess this replaced. CURVE 1.6 measures ~41% on pink noise.
   */
  update(bands: Uint8Array, curve: number = BandSmoother.CURVE): void {
    const n = this.levels.length;
    for (let i = 0; i < n; i++) {
      // Normalize, then apply the contrast curve.
      let v = bands[i] / 255;
      v = Math.pow(v, curve);

      const prev = this.levels[i];
      const rate = v > prev ? BandSmoother.ATTACK : BandSmoother.DECAY;
      const level = prev + (v - prev) * rate;
      this.levels[i] = level;

      if (level >= this.peaks[i]) {
        this.peaks[i] = level;
        this.velocities[i] = 0;
      } else {
        this.velocities[i] += BandSmoother.GRAVITY;
        this.peaks[i] = Math.max(level, this.peaks[i] - this.velocities[i]);
      }
    }
  }

  /** Collapse to silence — used when playback stops so nothing is left frozen. */
  reset(): void {
    this.levels.fill(0);
    this.peaks.fill(0);
    this.velocities.fill(0);
  }
}
