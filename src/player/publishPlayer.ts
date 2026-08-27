import React from 'react';
import {
  applyPlayerCommand,
  buildPlayerSnapshot,
  buildProgress,
  type PlayerCommand,
  type PlayerEngine,
  type PlayerStateSource,
} from './playerProtocol';

// ENGINE SIDE of the cross-window player bus. Mounted once, in the renderer that
// actually runs useAudioPlayer. It does two things and nothing else:
//   1. publishes the full PlayerSnapshot when a heavy field changes, and a tiny
//      progress patch on every tick (the split that keeps the big `playlist`
//      array off the ~4x/sec path — see playerProtocol.ts);
//   2. applies incoming PlayerCommands from other windows to the live engine.
//
// Modeled exactly on useRemoteServer: it READS the player's public state and
// CALLS its public methods, never touching useAudioPlayer's internals. That's
// what keeps this a contained layer ([[extending-safely]]).

interface PlayerBusBridge {
  playerPublish?: (snapshot: unknown) => void;
  playerPublishProgress?: (patch: unknown) => void;
  onPlayerCommand?: (cb: (cmd: unknown) => void) => () => void;
}

const bridge = (): PlayerBusBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as PlayerBusBridge | undefined;

/** Everything publishPlayer needs off the useAudioPlayer return. */
export interface PublishPlayerArgs extends PlayerStateSource, PlayerEngine {}

export function usePublishPlayer(player: PublishPlayerArgs): void {
  // Freshest engine for the mount-once command subscription, without making it a
  // dependency (which would re-subscribe every render). Same trick as
  // useRemoteServer's transportRef.
  const engineRef = React.useRef<PlayerEngine>(player);
  React.useEffect(() => { engineRef.current = player; });

  // Apply commands from any window. Subscribed once; reads the ref.
  React.useEffect(() => {
    const api = bridge();
    if (!api?.onPlayerCommand) return;
    return api.onPlayerCommand((raw) => {
      applyPlayerCommand(engineRef.current, raw as PlayerCommand);
    });
  }, []);

  // Publish the FULL snapshot when a heavy/structural field changes. `playlist`,
  // `userPlaylists`, `wires`, `unlinkedFolders` are reference-stable between
  // renders unless they actually change, so this fires rarely.
  React.useEffect(() => {
    bridge()?.playerPublish?.(buildPlayerSnapshot(player));
    // Intentionally keyed on the heavy fields + control fields, NOT progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    player.playlist, player.userPlaylists, player.wires, player.unlinkedFolders,
    player.currentIndex, player.isMuted, player.volume, player.shuffle, player.repeatMode,
    player.playbackRate, player.crossfade, player.normalizeVolume, player.streamPlayback,
    player.sleepDeadline, player.eq, player.distortion, player.diskUsage, player.queue,
  ]);

  // Publish the tiny progress patch on every tick.
  React.useEffect(() => {
    bridge()?.playerPublishProgress?.(buildProgress(player));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.progress, player.duration, player.currentIndex, player.isPlaying]);
}
