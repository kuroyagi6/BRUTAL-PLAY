import React from 'react';
import type { PlayerApi } from './PlayerContext';
import type { NodeRef } from '../audio/wires';
import type { PlayerCommand, PlayerSnapshot, PlayerProgress } from './playerProtocol';
import { applyProgress } from './playerProtocol';
import { createCommandSenders, deriveCurrentTrack, EMPTY_SNAPSHOT } from './playerClient';

// CLIENT-window backing for usePlayer(). Returns the SAME PlayerApi shape the
// real useAudioPlayer returns, but every field is fed by the IPC bus: state in
// via snapshot + progress, actions out via commands. A window using this never
// runs the audio engine, so it can't block it.
//
// The return is annotated `PlayerApi`, so if useAudioPlayer's public shape ever
// changes, the compiler forces this to keep up — the guarantee that keeps every
// `usePlayer()` consumer working whether it's fed the real hook or this one.

interface PlayerBusBridge {
  onPlayerSnapshot?: (cb: (s: PlayerSnapshot) => void) => () => void;
  onPlayerProgress?: (cb: (p: PlayerProgress) => void) => () => void;
  playerCommand?: (cmd: PlayerCommand) => void;
  playerRequestSnapshot?: () => Promise<PlayerSnapshot | null>;
}

const bridge = (): PlayerBusBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as PlayerBusBridge | undefined;

export function usePlayerBus(): PlayerApi {
  const [snapshot, setSnapshot] = React.useState<PlayerSnapshot>(EMPTY_SNAPSHOT);

  React.useEffect(() => {
    const api = bridge();
    if (!api) return; // not in Electron: stays on EMPTY_SNAPSHOT (harmless)
    // Pull the cached snapshot immediately so we don't render empty until the
    // next publish.
    api.playerRequestSnapshot?.().then((s) => { if (s) setSnapshot(s); }).catch(() => {});
    const offSnap = api.onPlayerSnapshot?.((s) => setSnapshot(s));
    // Progress patches merge onto the latest snapshot (the split that keeps the
    // heavy playlist off the ~4x/sec path — see playerProtocol.ts).
    const offProg = api.onPlayerProgress?.((p) => setSnapshot((prev) => applyProgress(prev, p)));
    return () => { offSnap?.(); offProg?.(); };
  }, []);

  // Command senders are stable — they only close over the bridge send. Built once.
  const senders = React.useMemo(
    () => createCommandSenders((cmd) => bridge()?.playerCommand?.(cmd)),
    []
  );

  const currentTrack = deriveCurrentTrack(snapshot);

  return {
    // ─ state (from snapshot) ─
    playlist: snapshot.playlist,
    currentTrack,
    currentIndex: snapshot.currentIndex,
    isPlaying: snapshot.isPlaying,
    progress: snapshot.progress,
    duration: snapshot.duration,
    diskUsage: snapshot.diskUsage,
    // AnalyserNode can't cross a process — client windows draw the visualizer
    // from streamed frames instead (Phase 2). Null here by design.
    analyser: null,
    queue: snapshot.queue,
    isMuted: snapshot.isMuted,
    volume: snapshot.volume,
    shuffle: snapshot.shuffle,
    repeatMode: snapshot.repeatMode,
    playbackRate: snapshot.playbackRate,
    crossfade: snapshot.crossfade,
    normalizeVolume: snapshot.normalizeVolume,
    streamPlayback: snapshot.streamPlayback,
    sleepDeadline: snapshot.sleepDeadline,
    eq: snapshot.eq,
    distortion: snapshot.distortion,
    userPlaylists: snapshot.userPlaylists,
    wires: snapshot.wires,
    unlinkedFolders: snapshot.unlinkedFolders,
    // ─ actions (out via commands) ─
    ...senders,
    // Browser-only FileList import path — unused in Electron; no-op on a client.
    addFiles: (_files: FileList) => Promise.resolve(),
    // Video/YouTube wire handoff is registered IN the engine host, never a
    // client. No-op keeps the PlayerApi shape without owning the handoff.
    setVideoWireHandler: (_fn: ((node: NodeRef) => boolean) | null) => {},
    setYouTubeWireHandler: (_fn: ((node: NodeRef) => boolean) | null) => {},
  };
}
