// CLIENT SIDE of the player bus, pure half. No React, no DOM, no Electron — so a
// test drives it directly. `usePlayerBus` (the hook) is a thin wrapper that holds
// snapshot state and spreads these into the full PlayerApi shape.
//
// The command senders here are the mirror image of applyPlayerCommand: where the
// engine turns a PlayerCommand into an engine call, the client turns a UI call
// into a PlayerCommand. Return values are faked (the real effect lands via the
// next snapshot) — see the per-method notes.
//
// Run the tests with: npx tsx src/player/playerClient.test.ts

import type { Track } from '../types';
import type { NodeRef } from '../audio/wires';
import type { PlayerCommand, PlayerSnapshot } from './playerProtocol';

/** State a fresh client shows before the first snapshot arrives. */
export const EMPTY_SNAPSHOT: PlayerSnapshot = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  progress: 0,
  duration: 0,
  diskUsage: 0,
  queue: [],
  isMuted: false,
  volume: 1,
  shuffle: false,
  repeatMode: 'none',
  playbackRate: 1,
  crossfade: 0,
  normalizeVolume: false,
  streamPlayback: false,
  sleepDeadline: null,
  eq: { bass: 0, mid: 0, treble: 0 },
  distortion: 0,
  userPlaylists: [],
  wires: [],
  unlinkedFolders: [],
};

/** The engine sends currentIndex; the client recomputes currentTrack from it. */
export function deriveCurrentTrack(snap: PlayerSnapshot): Track | null {
  return snap.playlist[snap.currentIndex] ?? null;
}

/**
 * Every player method that mutates state, rebuilt as a command sender. Async
 * methods resolve immediately with a placeholder — the caller's UI updates from
 * the snapshot that follows, not the return value. The ONE caller that consumes
 * a return today (App using `createPlaylist`'s new id to open the window) stays
 * on the real engine, not the bus — see the isolation plan.
 */
export function createCommandSenders(send: (cmd: PlayerCommand) => void) {
  return {
    togglePlay: () => send({ type: 'togglePlay' }),
    playTrack: (index: number, orderedIds?: string[], source?: NodeRef) =>
      send({ type: 'playTrack', index, orderedIds, source }),
    playNext: () => send({ type: 'playNext' }),
    playPrev: () => send({ type: 'playPrev' }),
    seek: (time: number) => send({ type: 'seek', value: time }),
    setVolume: (v: number) => send({ type: 'setVolume', value: v }),
    toggleMute: () => send({ type: 'toggleMute' }),
    toggleShuffle: () => send({ type: 'toggleShuffle' }),
    toggleRepeat: () => send({ type: 'toggleRepeat' }),
    setPlaybackRate: (v: number) => send({ type: 'setPlaybackRate', value: v }),
    setCrossfade: (v: number) => send({ type: 'setCrossfade', value: v }),
    setNormalizeVolume: (v: boolean) => send({ type: 'setNormalizeVolume', value: v }),
    setStreamPlayback: (v: boolean) => send({ type: 'setStreamPlayback', value: v }),
    setSleepTimer: (minutes: number | null) => send({ type: 'setSleepTimer', minutes }),
    updateEq: (band: 'bass' | 'mid' | 'treble', value: number) => send({ type: 'updateEq', band, value }),
    updateDistortion: (value: number) => send({ type: 'updateDistortion', value }),
    addWire: (from: NodeRef, to: NodeRef) => send({ type: 'addWire', from, to }),
    removeWire: (from: NodeRef, to: NodeRef) => send({ type: 'removeWire', from, to }),
    removeNodeWires: (node: NodeRef) => send({ type: 'removeNodeWires', node }),
    toggleFolderLink: (path: string) => send({ type: 'toggleFolderLink', path }),
    playWireNode: (node: NodeRef) => send({ type: 'playWireNode', node }),
    // Async methods: fire the command, resolve with a placeholder immediately.
    removeTrack: (id: string): Promise<void> => { send({ type: 'removeTrack', trackId: id }); return Promise.resolve(); },
    removeDuplicates: (): Promise<number> => { send({ type: 'removeDuplicates' }); return Promise.resolve(0); },
    updateTrackDetails: (id: string, updates: Partial<Track>): Promise<void> => {
      send({ type: 'updateTrackDetails', trackId: id, updates });
      return Promise.resolve();
    },
    addNativeFiles: (paths: string[]): Promise<{ added: number; skipped: number; persistFailed: number }> => {
      send({ type: 'addNativeFiles', paths });
      return Promise.resolve({ added: 0, skipped: 0, persistFailed: 0 });
    },
    createPlaylist: (name: string): Promise<string> => { send({ type: 'createPlaylist', name }); return Promise.resolve(''); },
    renamePlaylist: (playlistId: string, name: string): Promise<void> => {
      send({ type: 'renamePlaylist', playlistId, name });
      return Promise.resolve();
    },
    addTrackToPlaylist: (playlistId: string, trackId: string): Promise<void> => {
      send({ type: 'addTrackToPlaylist', playlistId, trackId });
      return Promise.resolve();
    },
    removeTrackFromPlaylist: (playlistId: string, trackId: string): Promise<void> => {
      send({ type: 'removeTrackFromPlaylist', playlistId, trackId });
      return Promise.resolve();
    },
    deletePlaylist: (playlistId: string): Promise<void> => { send({ type: 'deletePlaylist', playlistId }); return Promise.resolve(); },
  };
}

export type CommandSenders = ReturnType<typeof createCommandSenders>;
