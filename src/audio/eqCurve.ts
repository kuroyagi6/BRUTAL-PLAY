// Magnitude response of the 3-band EQ, as pure math. No Web Audio, no DOM.
//
// WHY THIS EXISTS: the FX rack's analyzer draws the curve the EQ is imposing on
// the signal. BiquadFilterNode has getFrequencyResponse(), but that only works
// when an AudioContext exists — i.e. only after the user has started playback.
// The rack has to draw a correct curve while silent, so the response is derived
// from the same filter definitions the graph uses instead of measured from it.
//
// The filters mirror createAudioGraph() exactly:
//   bass   lowshelf  @ 200Hz
//   mid    peaking   @ 1kHz, Q 1
//   treble highshelf @ 3kHz
// If those change in audioGraph.ts, change them here too — this file is the
// picture of that chain, not an independent design.
//
// Run the tests with: npx tsx src/audio/eqCurve.test.ts

export interface EqBands {
  bass: number;
  mid: number;
  treble: number;
}

/** Web Audio's shelving filters are fixed at shelf slope S = 1. */
const SHELF_SLOPE_ALPHA = Math.SQRT1_2;

/** Biquad coefficients, unnormalized (a0 is applied at evaluation time). */
interface Biquad {
  b0: number; b1: number; b2: number;
  a0: number; a1: number; a2: number;
}

function lowShelf(freq: number, gainDb: number, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * (SHELF_SLOPE_ALPHA * 2);
  const sq = 2 * Math.sqrt(A) * alpha;
  return {
    b0: A * ((A + 1) - (A - 1) * cos + sq),
    b1: 2 * A * ((A - 1) - (A + 1) * cos),
    b2: A * ((A + 1) - (A - 1) * cos - sq),
    a0: (A + 1) + (A - 1) * cos + sq,
    a1: -2 * ((A - 1) + (A + 1) * cos),
    a2: (A + 1) + (A - 1) * cos - sq,
  };
}

function highShelf(freq: number, gainDb: number, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * (SHELF_SLOPE_ALPHA * 2);
  const sq = 2 * Math.sqrt(A) * alpha;
  return {
    b0: A * ((A + 1) + (A - 1) * cos + sq),
    b1: -2 * A * ((A - 1) + (A + 1) * cos),
    b2: A * ((A + 1) + (A - 1) * cos - sq),
    a0: (A + 1) - (A - 1) * cos + sq,
    a1: 2 * ((A - 1) - (A + 1) * cos),
    a2: (A + 1) - (A - 1) * cos - sq,
  };
}

function peaking(freq: number, gainDb: number, q: number, sampleRate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return {
    b0: 1 + alpha * A,
    b1: -2 * cos,
    b2: 1 - alpha * A,
    a0: 1 + alpha / A,
    a1: -2 * cos,
    a2: 1 - alpha / A,
  };
}

/** |H(e^jw)| of one biquad at `freq`, in dB. */
function magnitudeDb(f: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const nRe = f.b0 + f.b1 * cos1 + f.b2 * cos2;
  const nIm = -(f.b1 * sin1 + f.b2 * sin2);
  const dRe = f.a0 + f.a1 * cos1 + f.a2 * cos2;
  const dIm = -(f.a1 * sin1 + f.a2 * sin2);
  const num = Math.hypot(nRe, nIm);
  const den = Math.hypot(dRe, dIm);
  if (den === 0) return 0;
  return 20 * Math.log10(num / den);
}

/**
 * Combined gain of the three EQ bands at `freq`, in dB. Cascaded filters
 * multiply, so in dB they simply add.
 */
export function eqGainAt(eq: EqBands, freq: number, sampleRate = 44100): number {
  return (
    magnitudeDb(lowShelf(200, eq.bass, sampleRate), freq, sampleRate) +
    magnitudeDb(peaking(1000, eq.mid, 1, sampleRate), freq, sampleRate) +
    magnitudeDb(highShelf(3000, eq.treble, sampleRate), freq, sampleRate)
  );
}

/**
 * `count` log-spaced frequencies from `fMin` to `fMax`. The same spacing the
 * spectrum bands use, so the curve lines up with the bars drawn under it.
 */
export function logFrequencies(count: number, fMin = 30, fMax = 16000): Float32Array {
  const out = new Float32Array(count);
  const logMin = Math.log(fMin);
  const logMax = Math.log(fMax);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    out[i] = Math.exp(logMin + t * (logMax - logMin));
  }
  return out;
}

/** The EQ response sampled across `freqs`, in dB. */
export function eqCurve(eq: EqBands, freqs: Float32Array, sampleRate = 44100): Float32Array {
  const out = new Float32Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) out[i] = eqGainAt(eq, freqs[i], sampleRate);
  return out;
}
