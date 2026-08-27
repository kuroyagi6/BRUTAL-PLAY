import React from 'react';
import { packVizFrame, VIZ_FREQ_LEN, VIZ_TIME_LEN } from './visualizerFrame';
import { buildBandRanges, reduceToBands } from './spectrumBands';

// ENGINE SIDE of the visualizer stream. Mounted where the AnalyserNode lives
// (the engine host). Reads the analyser ~30x/sec and posts a packed frame — but
// ONLY when a client window is actually subscribed (demand) AND audio is
// playing. In the current single window nothing subscribes, so `demand` stays
// false and this loop never runs: zero overhead, no behavior change.

interface VizBridge {
  onVizDemand?: (cb: (active: boolean) => void) => () => void;
  publishVizFrame?: (buf: Uint8Array) => void;
}

const bridge = (): VizBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as VizBridge | undefined;

const FRAME_INTERVAL = 1000 / 30;

export function usePublishVisualizer(analyser: AnalyserNode | null, isPlaying: boolean): void {
  // Whether any client window wants frames. State (not a ref) so the streaming
  // effect starts/stops as demand flips — the loop only exists while needed.
  const [demand, setDemand] = React.useState(false);
  React.useEffect(() => {
    const api = bridge();
    if (!api?.onVizDemand) return;
    return api.onVizDemand(setDemand);
  }, []);

  React.useEffect(() => {
    const api = bridge();
    if (!api?.publishVizFrame || !analyser || !isPlaying || !demand) return;

    const bins = analyser.frequencyBinCount;
    const raw = new Uint8Array(bins);
    // Reduce the 512 raw bins to log-spaced bands HERE rather than shipping them
    // all: the client then draws from the same shaped data the host does, and
    // the frame stays small enough to send 30x/sec without thinking about it.
    const ranges = buildBandRanges(bins, analyser.context.sampleRate);
    const freq = new Uint8Array(VIZ_FREQ_LEN);
    const time = new Uint8Array(VIZ_TIME_LEN);
    // A TIMER, not requestAnimationFrame. rAF is gated on the window being
    // composited, so in the backgrounded desktop window (the producer) it fires
    // slowly/in bursts and starves the popped-out visualizer. setInterval isn't
    // tied to compositing, so with backgroundThrottling off it holds a steady
    // 30fps even when this window is hidden behind the popped-out one.
    const id = setInterval(() => {
      analyser.getByteFrequencyData(raw);
      reduceToBands(raw, ranges, freq);
      analyser.getByteTimeDomainData(time);
      api.publishVizFrame!(packVizFrame(freq, time));
    }, FRAME_INTERVAL);
    return () => clearInterval(id);
  }, [analyser, isPlaying, demand]);
}
