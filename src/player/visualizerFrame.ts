// Pure framing for the visualizer stream. No React/DOM/Electron. One frame packs
// the two spectra the Visualizer can draw (frequency + time-domain) into a single
// flat Uint8Array so it crosses IPC as one small message instead of two.
//
// The frequency half is NOT raw FFT bins — the engine reduces its 512 bins to
// VIZ_BANDS log-spaced bands before publishing (see spectrumBands.ts), so the
// client draws exactly what the engine host draws and the wire stays small.
// The two halves therefore have DIFFERENT lengths; the split point is the fixed
// constant below, not the midpoint.
//
// 64 band bytes + 256 time bytes = 320 bytes/frame -> ~9.6 KB/s at 30fps.
//
// Run the tests with: npx tsx src/player/visualizerFrame.test.ts

import type { VisualizerFrames } from '../components/Visualizer';
import { VIZ_BANDS } from './spectrumBands';

/** Length of the frequency half: one byte per log-spaced band. */
export const VIZ_FREQ_LEN = VIZ_BANDS;
/** Length of the time-domain half. More points than bands = a smoother trace. */
export const VIZ_TIME_LEN = 256;

/** Concatenate [frequency | timeDomain] into one wire frame. */
export function packVizFrame(frequency: Uint8Array, timeDomain: Uint8Array): Uint8Array {
  const out = new Uint8Array(frequency.length + timeDomain.length);
  out.set(frequency, 0);
  out.set(timeDomain, frequency.length);
  return out;
}

/**
 * Split a wire frame back into the caller's STABLE container, mutating its arrays
 * in place (never reallocating) so the memo'd Visualizer isn't forced to
 * re-render. Splits at the container's own frequency length — both sides derive
 * it from VIZ_FREQ_LEN. Tolerant of a short/long frame: copies whatever fits.
 */
export function unpackVizFrame(buf: Uint8Array, into: VisualizerFrames): void {
  const split = into.frequency.length;
  const fN = Math.min(split, buf.length);
  const tN = Math.min(buf.length - fN, into.timeDomain.length);
  into.frequency.set(buf.subarray(0, fN), 0);
  into.timeDomain.set(buf.subarray(split, split + tN), 0);
}

/** A zeroed frame container sized to the engine's wire lengths. */
export function emptyVizFrames(): VisualizerFrames {
  return {
    frequency: new Uint8Array(VIZ_FREQ_LEN),
    timeDomain: new Uint8Array(VIZ_TIME_LEN),
  };
}
