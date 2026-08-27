import React from 'react';
import type { VisualizerFrames } from '../components/Visualizer';
import { emptyVizFrames, unpackVizFrame } from './visualizerFrame';

// CLIENT SIDE of the visualizer stream. A window without the AnalyserNode calls
// this to draw the spectrum from IPC frames instead. Pass `active` = true only
// when this window is actually showing the visualizer (STAGE visible) so the
// engine isn't asked to stream to a hidden canvas.
//
// Returns a STABLE container whose arrays are updated in place — feeding it to
// <Visualizer frames={...}> won't re-render that memo'd component 30x/sec; the
// draw loop reads the latest bytes each frame. Returns null when inactive so
// the Visualizer falls back to its analyser path.

interface VizBridge {
  vizSubscribe?: () => void;
  vizUnsubscribe?: () => void;
  onVizFrame?: (cb: (buf: Uint8Array) => void) => () => void;
}

const bridge = (): VizBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as VizBridge | undefined;

export function useVisualizerFrames(active: boolean): VisualizerFrames | null {
  // One stable container for this hook's lifetime.
  const framesRef = React.useRef<VisualizerFrames>(emptyVizFrames());

  React.useEffect(() => {
    if (!active) return;
    const api = bridge();
    if (!api?.vizSubscribe) return;
    api.vizSubscribe(); // bumps demand so the engine starts streaming
    const off = api.onVizFrame?.((buf) => unpackVizFrame(buf, framesRef.current));
    return () => {
      off?.();
      api.vizUnsubscribe?.();
    };
  }, [active]);

  return active ? framesRef.current : null;
}
