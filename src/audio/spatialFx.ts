// Spatial FX: reverb, delay and stereo width, as a self-contained send section
// that SPLICES into an existing chain.
//
// WHY IT'S BUILT THIS WAY: createAudioGraph() owns the core chain (EQ → drive →
// compressor → fade → analyser) and that chain works. Rather than rewrite it to
// thread three more effects through, this module builds its own little graph
// with one input and one output and inserts itself between two existing nodes.
// audioGraph.ts is not touched, so nothing that plays today can break — if the
// insert were removed, the original chain would still be connected end to end.
//
// Reverb and delay are SENDS: the dry signal always passes at unity and the wet
// signal is added on top, so at zero they are provably transparent (a gain of 0
// contributes nothing) rather than "hopefully neutral".
//
// Run the tests with: npx tsx src/audio/spatialFx.test.ts

export interface SpatialParams {
  /** Reverb send, 0-100. */
  reverb: number;
  /** Delay send, 0-100. */
  delay: number;
  /** Delay time in seconds. */
  delayTime: number;
  /** Stereo width, 0-200 percent. 0 = mono, 100 = untouched, 200 = doubled. */
  width: number;
}

export const SPATIAL_DEFAULTS: SpatialParams = { reverb: 0, delay: 0, delayTime: 0.3, width: 100 };

/** Ceiling on the wet sends. Full-scale wet on top of full-scale dry clips. */
const REVERB_MAX_WET = 0.55;
const DELAY_MAX_WET = 0.5;
/** Echo repeats. Above ~0.7 the feedback loop runs away and never decays. */
const DELAY_FEEDBACK = 0.35;
const MAX_DELAY_SECONDS = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Reverb send level (0-1) for a 0-100 slider. */
export function reverbWetGain(amount: number): number {
  return (clamp(amount, 0, 100) / 100) * REVERB_MAX_WET;
}

/** Delay send level (0-1) for a 0-100 slider. */
export function delayWetGain(amount: number): number {
  return (clamp(amount, 0, 100) / 100) * DELAY_MAX_WET;
}

/**
 * Side-channel gain for a width percentage. The mid/side matrix is
 * `L = mid + side*g`, `R = mid - side*g`, so g === 1 reconstructs the input
 * exactly — width 100 has to be bit-transparent or every track gets quietly
 * reprocessed just by the module existing.
 */
export function sideGainFor(widthPercent: number): number {
  return clamp(widthPercent, 0, 200) / 100;
}

/** Delay time clamped to what the DelayNode was built to hold. */
export function delayTimeFor(seconds: number): number {
  return clamp(seconds, 0.01, MAX_DELAY_SECONDS);
}

/**
 * A decaying-noise impulse response. Generated rather than shipped as a .wav:
 * a 2-second stereo IR is ~700KB on disk and this is ~3ms of Math.random().
 */
export function makeImpulseResponse(ctx: BaseAudioContext, seconds = 2.2, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // Exponential decay; the tail is what makes it read as a room.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export interface SpatialFxNodes {
  input: GainNode;
  output: GainNode;
  setReverb(amount: number): void;
  setDelay(amount: number): void;
  setDelayTime(seconds: number): void;
  setWidth(percent: number): void;
}

/**
 * Build the send section:
 *
 *   input → [mid/side width matrix] → merger ─┬─────────────────→ output
 *                                             ├─ convolver → wet ─┘
 *                                             └─ delay ─────→ wet ─┘
 *                                                  ↑ feedback ┘
 */
export function createSpatialFx(ctx: AudioContext, params: SpatialParams): SpatialFxNodes {
  const input = ctx.createGain();
  // Force stereo. On a mono file the splitter's second channel would otherwise
  // be silent, making side === mid and collapsing the right channel to zero.
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  const output = ctx.createGain();

  // ── Mid/side width matrix ──────────────────────────────────────────────
  const splitter = ctx.createChannelSplitter(2);
  const mid = ctx.createGain();      // 0.5*(L+R)
  mid.gain.value = 0.5;
  const side = ctx.createGain();     // 0.5*(L-R)
  side.gain.value = 0.5;
  const invR = ctx.createGain();     // -R, so `side` sums to a difference
  invR.gain.value = -1;
  const widthGain = ctx.createGain();
  widthGain.gain.value = sideGainFor(params.width);
  const invSide = ctx.createGain();  // -side*g for the right channel
  invSide.gain.value = -1;
  const leftSum = ctx.createGain();
  const rightSum = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  input.connect(splitter);
  splitter.connect(mid, 0);
  splitter.connect(mid, 1);
  splitter.connect(side, 0);
  splitter.connect(invR, 1);
  invR.connect(side);
  side.connect(widthGain);
  widthGain.connect(invSide);

  mid.connect(leftSum);
  widthGain.connect(leftSum);
  mid.connect(rightSum);
  invSide.connect(rightSum);

  leftSum.connect(merger, 0, 0);
  rightSum.connect(merger, 0, 1);

  // ── Dry path ───────────────────────────────────────────────────────────
  merger.connect(output);

  // ── Reverb send ────────────────────────────────────────────────────────
  const convolver = ctx.createConvolver();
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = reverbWetGain(params.reverb);
  merger.connect(convolver);
  convolver.connect(reverbWet);
  reverbWet.connect(output);

  // ── Delay send ─────────────────────────────────────────────────────────
  const delayNode = ctx.createDelay(MAX_DELAY_SECONDS);
  delayNode.delayTime.value = delayTimeFor(params.delayTime);
  const feedback = ctx.createGain();
  feedback.gain.value = DELAY_FEEDBACK;
  const delayWet = ctx.createGain();
  delayWet.gain.value = delayWetGain(params.delay);
  merger.connect(delayNode);
  delayNode.connect(feedback);
  feedback.connect(delayNode);
  delayNode.connect(delayWet);
  delayWet.connect(output);

  // The IR is only built once the effect is actually wanted. A ConvolverNode
  // with a null buffer outputs silence and does no convolution work, so an
  // unused reverb costs nothing — this is the "off means off" guarantee.
  const ensureImpulse = () => {
    if (!convolver.buffer) convolver.buffer = makeImpulseResponse(ctx);
  };
  if (params.reverb > 0) ensureImpulse();

  return {
    input,
    output,
    setReverb(amount) {
      if (amount > 0) ensureImpulse();
      reverbWet.gain.value = reverbWetGain(amount);
    },
    setDelay(amount) {
      delayWet.gain.value = delayWetGain(amount);
    },
    setDelayTime(seconds) {
      delayNode.delayTime.value = delayTimeFor(seconds);
    },
    setWidth(percent) {
      widthGain.gain.value = sideGainFor(percent);
    },
  };
}

/**
 * Splice the section between two already-connected nodes:
 * `from → to` becomes `from → fx → to`.
 */
export function insertSpatialFx(fx: SpatialFxNodes, from: AudioNode, to: AudioNode): void {
  try {
    from.disconnect(to);
  } catch {
    // Not connected the way we assumed — inserting in parallel would double the
    // signal, so bail out and leave the original chain exactly as it was.
    return;
  }
  from.connect(fx.input);
  fx.output.connect(to);
}
