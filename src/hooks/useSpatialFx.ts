import React from 'react';
import { usePersistentState } from './usePersistentState';
import { createSpatialFx, insertSpatialFx, SPATIAL_DEFAULTS, type SpatialFxNodes } from '../audio/spatialFx';

/**
 * Reverb / delay / stereo-width state, composed into useAudioPlayer.
 *
 * The engine hook doesn't learn what these effects are: it calls `attach` once,
 * right after the core graph is built, and spreads the returned values into its
 * public API. Everything else — persistence, clamping, live node updates —
 * lives here, so the transport can't be broken by an edit to the FX.
 */
export function useSpatialFx() {
  const [reverb, setReverbState] = usePersistentState('brutal-reverb', SPATIAL_DEFAULTS.reverb);
  const [delay, setDelayState] = usePersistentState('brutal-delay', SPATIAL_DEFAULTS.delay);
  const [delayTime, setDelayTimeState] = usePersistentState('brutal-delayTime', SPATIAL_DEFAULTS.delayTime);
  const [stereoWidth, setStereoWidthState] = usePersistentState('brutal-stereoWidth', SPATIAL_DEFAULTS.width);

  const nodesRef = React.useRef<SpatialFxNodes | null>(null);

  // The live values, readable from the stable `attach` callback below without
  // making it a new function on every slider move (initAudioContext depends on
  // it, and a changing identity there churns the whole engine's callbacks).
  const paramsRef = React.useRef({ reverb, delay, delayTime, width: stereoWidth });
  paramsRef.current = { reverb, delay, delayTime, width: stereoWidth };

  /** Splice the FX section between two nodes of an existing chain. */
  const attach = React.useCallback((ctx: AudioContext, from: AudioNode, to: AudioNode) => {
    if (nodesRef.current) return;
    const fx = createSpatialFx(ctx, paramsRef.current);
    insertSpatialFx(fx, from, to);
    nodesRef.current = fx;
  }, []);

  const setReverb = React.useCallback((v: number) => {
    setReverbState(v);
    nodesRef.current?.setReverb(v);
  }, [setReverbState]);

  const setDelay = React.useCallback((v: number) => {
    setDelayState(v);
    nodesRef.current?.setDelay(v);
  }, [setDelayState]);

  const setDelayTime = React.useCallback((v: number) => {
    setDelayTimeState(v);
    nodesRef.current?.setDelayTime(v);
  }, [setDelayTimeState]);

  const setStereoWidth = React.useCallback((v: number) => {
    setStereoWidthState(v);
    nodesRef.current?.setWidth(v);
  }, [setStereoWidthState]);

  const resetSpatialFx = React.useCallback(() => {
    setReverb(SPATIAL_DEFAULTS.reverb);
    setDelay(SPATIAL_DEFAULTS.delay);
    setDelayTime(SPATIAL_DEFAULTS.delayTime);
    setStereoWidth(SPATIAL_DEFAULTS.width);
  }, [setReverb, setDelay, setDelayTime, setStereoWidth]);

  return {
    reverb, setReverb,
    delay, setDelay,
    delayTime, setDelayTime,
    stereoWidth, setStereoWidth,
    resetSpatialFx,
    attachSpatialFx: attach,
  };
}
