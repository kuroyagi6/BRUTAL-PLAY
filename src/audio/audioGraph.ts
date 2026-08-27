// Web Audio graph construction and DSP helpers. Isolates all the node wiring
// so features (EQ, distortion, normalization, crossfade) have one place to live
// and the player hook stays about *state*, not signal routing.

export function makeDistortionCurve(amount: number): Float32Array {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/** Volume normalization: a compressor evens loud vs quiet tracks, normGain adds
 *  makeup gain. When disabled the nodes are transparent (ratio 1, unity gain). */
export function applyNormalization(
  compressor: DynamicsCompressorNode,
  normGain: GainNode,
  enabled: boolean
): void {
  if (enabled) {
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    normGain.gain.value = 1.3;
  } else {
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    normGain.gain.value = 1;
  }
}

export interface AudioGraph {
  analyser: AnalyserNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  distortion: WaveShaperNode;
  compressor: DynamicsCompressorNode;
  normGain: GainNode;
  fadeGain: GainNode;
}

export interface GraphOptions {
  eq: { bass: number; mid: number; treble: number };
  distortion: number;
  normalize: boolean;
}

/**
 * Build and connect the full processing chain:
 *   source → bass → mid → treble → distortion → compressor → normGain → fadeGain
 *          → analyser → destination
 * Returns the nodes so the caller can tweak them later (EQ sliders, etc.).
 */
export function createAudioGraph(
  ctx: AudioContext,
  source: MediaElementAudioSourceNode,
  opts: GraphOptions
): AudioGraph {
  const analyser = ctx.createAnalyser();
  // 1024 -> 512 bins @ ~43Hz each. 256 gave only 128 bins at ~172Hz, which is
  // wider than the gap between two bass notes, so the low end (where music
  // actually lives) collapsed into 3 indistinguishable bars. The visualizer
  // reduces these to log-spaced bands, so the extra bins cost drawing nothing.
  analyser.fftSize = 1024;
  // Some temporal averaging in the node itself; the visualizer's own envelope
  // follower does the rest. Higher than this smears transients into porridge.
  analyser.smoothingTimeConstant = 0.72;
  // minDecibels/maxDecibels are deliberately left at their defaults (-100/-30).
  // Narrowing the window was measured against a real AnalyserNode fed pink noise
  // and made the display DARKER, not brighter: raising the floor to -85 clipped
  // quiet bins to zero (mean bar height 29% vs 46% at the default). Contrast is
  // handled in spectrumBands instead, where it can be tuned without touching the
  // audio graph.

  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 200;
  bass.gain.value = opts.eq.bass;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 1;
  mid.gain.value = opts.eq.mid;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 3000;
  treble.gain.value = opts.eq.treble;

  const distortion = ctx.createWaveShaper();
  distortion.curve = makeDistortionCurve(opts.distortion);
  distortion.oversample = '4x';

  const compressor = ctx.createDynamicsCompressor();
  const normGain = ctx.createGain();
  applyNormalization(compressor, normGain, opts.normalize);

  const fadeGain = ctx.createGain();
  fadeGain.gain.value = 1;

  source.connect(bass);
  bass.connect(mid);
  mid.connect(treble);
  treble.connect(distortion);
  distortion.connect(compressor);
  compressor.connect(normGain);
  normGain.connect(fadeGain);
  fadeGain.connect(analyser);
  analyser.connect(ctx.destination);

  return { analyser, bass, mid, treble, distortion, compressor, normGain, fadeGain };
}
