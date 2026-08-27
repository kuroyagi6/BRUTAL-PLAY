// Pure, framework-free contract for the cross-window PLAYER BUS.
//
// This is the same idea as src/remote/remoteProtocol.ts (the phone remote),
// widened from a handful of now-playing fields to the WHOLE player API. It lets
// the audio engine live in ONE renderer while every other window drives it over
// IPC: the engine publishes a `PlayerSnapshot`, windows send a `PlayerCommand`.
//
// Kept dependency-free (no React/DOM/Electron) so both sides and a test can
// import it, and so "what crosses a process boundary" has ONE definition.
// Everything here MUST be structured-clone-safe (no functions, no class
// instances, no AnalyserNode). The live visualizer stream is deliberately NOT
// here — it's a separate high-rate channel (see Phase 2 / useVisualizerFrames).
//
// Run the tests with: npx tsx src/player/playerProtocol.test.ts

import type { Track, Playlist } from '../types';
import type { Wire, NodeRef } from '../audio/wires';

/** EQ band gains, in dB-ish units the engine understands. */
export interface EqState {
  bass: number;
  mid: number;
  treble: number;
}

/**
 * The full serializable player state broadcast engine -> every window. Fields
 * mirror the serializable half of the `useAudioPlayer` return; the current
 * track is carried as an INDEX (clients recompute `currentTrack` from
 * `playlist[currentIndex]`) so there's one source of truth.
 *
 * NOTE on URLs: `Track.url` / `Track.coverUrl` may be `blob:` URLs, which are
 * scoped to the renderer that created them. Within one renderer (Phase 0/1
 * loopback) they're valid as-is. When windows become separate processes
 * (Phase 4), clients must rehydrate playback/art from `nativePath`/`coverHash`
 * rather than trusting a foreign blob URL — handled there, not here.
 */
export interface PlayerSnapshot {
  playlist: Track[];
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  diskUsage: number;
  queue: string[];
  isMuted: boolean;
  volume: number;
  shuffle: boolean;
  repeatMode: 'none' | 'one' | 'all';
  playbackRate: number;
  crossfade: number;
  normalizeVolume: boolean;
  streamPlayback: boolean;
  sleepDeadline: number | null;
  eq: EqState;
  distortion: number;
  userPlaylists: Playlist[];
  wires: Wire[];
  unlinkedFolders: string[];
}

/**
 * The tiny, high-rate patch broadcast on every progress tick (~4x/sec). Split
 * OUT of the full snapshot on purpose: the snapshot carries `playlist` (possibly
 * thousands of tracks), and structured-cloning that array several times a second
 * would cause exactly the main-thread jank this whole effort exists to remove.
 * The full snapshot is published only when a heavier field actually changes.
 */
export interface PlayerProgress {
  progress: number;
  duration: number;
  currentIndex: number;
  isPlaying: boolean;
}

/** Merge a progress patch onto a snapshot (clients + the main-process cache). */
export function applyProgress(snap: PlayerSnapshot, p: PlayerProgress): PlayerSnapshot {
  return { ...snap, progress: p.progress, duration: p.duration, currentIndex: p.currentIndex, isPlaying: p.isPlaying };
}

/** Extract just the high-rate fields from full engine state. */
export function buildProgress(s: PlayerStateSource): PlayerProgress {
  return { progress: s.progress, duration: s.duration, currentIndex: s.currentIndex, isPlaying: s.isPlaying };
}

/**
 * One command sent window -> engine. Only serializable payloads: functions that
 * take a `FileList` (the non-Electron `addFiles` fallback) are engine-local and
 * intentionally absent — native import crosses as `addNativeFiles` with paths.
 * Commands are fire-and-forget; return values (e.g. the new id from
 * createPlaylist) are observed via the next snapshot, not returned inline.
 */
export type PlayerCommand =
  | { type: 'togglePlay' }
  | { type: 'playTrack'; index: number; orderedIds?: string[]; source?: NodeRef }
  | { type: 'playNext' }
  | { type: 'playPrev' }
  | { type: 'seek'; value: number }
  | { type: 'setVolume'; value: number }
  | { type: 'toggleMute' }
  | { type: 'toggleShuffle' }
  | { type: 'toggleRepeat' }
  | { type: 'setPlaybackRate'; value: number }
  | { type: 'setCrossfade'; value: number }
  | { type: 'setNormalizeVolume'; value: boolean }
  | { type: 'setStreamPlayback'; value: boolean }
  | { type: 'setSleepTimer'; minutes: number | null }
  | { type: 'updateEq'; band: 'bass' | 'mid' | 'treble'; value: number }
  | { type: 'updateDistortion'; value: number }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'removeDuplicates' }
  | { type: 'updateTrackDetails'; trackId: string; updates: Partial<Track> }
  | { type: 'addNativeFiles'; paths: string[] }
  | { type: 'createPlaylist'; name: string }
  | { type: 'renamePlaylist'; playlistId: string; name: string }
  | { type: 'addTrackToPlaylist'; playlistId: string; trackId: string }
  | { type: 'removeTrackFromPlaylist'; playlistId: string; trackId: string }
  | { type: 'deletePlaylist'; playlistId: string }
  | { type: 'addWire'; from: NodeRef; to: NodeRef }
  | { type: 'removeWire'; from: NodeRef; to: NodeRef }
  | { type: 'removeNodeWires'; node: NodeRef }
  | { type: 'toggleFolderLink'; path: string }
  | { type: 'playWireNode'; node: NodeRef };

/**
 * The slice of the audio engine a command is allowed to drive. This is a
 * SUBSET of the `useAudioPlayer` return, named explicitly so `applyPlayerCommand`
 * has a typed target and a test can pass a fake. Every field here already exists
 * on that return — see src/hooks/useAudioPlayer.ts:659.
 */
export interface PlayerEngine {
  togglePlay: () => void;
  playTrack: (index: number, orderedIds?: string[], source?: NodeRef) => void;
  playNext: () => void;
  playPrev: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setPlaybackRate: (v: number) => void;
  setCrossfade: (v: number) => void;
  setNormalizeVolume: (v: boolean) => void;
  setStreamPlayback: (v: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  updateEq: (band: 'bass' | 'mid' | 'treble', value: number) => void;
  updateDistortion: (value: number) => void;
  removeTrack: (id: string) => void;
  removeDuplicates: () => void;
  updateTrackDetails: (id: string, updates: Partial<Track>) => void;
  addNativeFiles: (paths: string[]) => void;
  createPlaylist: (name: string) => void;
  renamePlaylist: (playlistId: string, name: string) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addWire: (from: NodeRef, to: NodeRef) => void;
  removeWire: (from: NodeRef, to: NodeRef) => void;
  removeNodeWires: (node: NodeRef) => void;
  toggleFolderLink: (path: string) => void;
  playWireNode: (node: NodeRef) => void;
}

/**
 * Run one command against the live engine. Exhaustive over `PlayerCommand` so a
 * new command can't be added to the union without the compiler flagging a
 * missing case here (`assertNever`). Pure dispatch — no React, no IPC — so the
 * test drives it with a spy engine and no DOM.
 */
export function applyPlayerCommand(engine: PlayerEngine, cmd: PlayerCommand): void {
  switch (cmd.type) {
    case 'togglePlay': return engine.togglePlay();
    case 'playTrack': return engine.playTrack(cmd.index, cmd.orderedIds, cmd.source);
    case 'playNext': return engine.playNext();
    case 'playPrev': return engine.playPrev();
    case 'seek': return engine.seek(cmd.value);
    case 'setVolume': return engine.setVolume(cmd.value);
    case 'toggleMute': return engine.toggleMute();
    case 'toggleShuffle': return engine.toggleShuffle();
    case 'toggleRepeat': return engine.toggleRepeat();
    case 'setPlaybackRate': return engine.setPlaybackRate(cmd.value);
    case 'setCrossfade': return engine.setCrossfade(cmd.value);
    case 'setNormalizeVolume': return engine.setNormalizeVolume(cmd.value);
    case 'setStreamPlayback': return engine.setStreamPlayback(cmd.value);
    case 'setSleepTimer': return engine.setSleepTimer(cmd.minutes);
    case 'updateEq': return engine.updateEq(cmd.band, cmd.value);
    case 'updateDistortion': return engine.updateDistortion(cmd.value);
    case 'removeTrack': return engine.removeTrack(cmd.trackId);
    case 'removeDuplicates': return engine.removeDuplicates();
    case 'updateTrackDetails': return engine.updateTrackDetails(cmd.trackId, cmd.updates);
    case 'addNativeFiles': return engine.addNativeFiles(cmd.paths);
    case 'createPlaylist': return engine.createPlaylist(cmd.name);
    case 'renamePlaylist': return engine.renamePlaylist(cmd.playlistId, cmd.name);
    case 'addTrackToPlaylist': return engine.addTrackToPlaylist(cmd.playlistId, cmd.trackId);
    case 'removeTrackFromPlaylist': return engine.removeTrackFromPlaylist(cmd.playlistId, cmd.trackId);
    case 'deletePlaylist': return engine.deletePlaylist(cmd.playlistId);
    case 'addWire': return engine.addWire(cmd.from, cmd.to);
    case 'removeWire': return engine.removeWire(cmd.from, cmd.to);
    case 'removeNodeWires': return engine.removeNodeWires(cmd.node);
    case 'toggleFolderLink': return engine.toggleFolderLink(cmd.path);
    case 'playWireNode': return engine.playWireNode(cmd.node);
    default: return assertNever(cmd);
  }
}

/** Compile-time exhaustiveness guard: unreachable unless a case is missing. */
function assertNever(x: never): never {
  throw new Error('Unhandled PlayerCommand: ' + JSON.stringify(x));
}

/**
 * The snapshot source the engine reads from. A SUPERSET-shaped view of the
 * `useAudioPlayer` return, listing only the fields the snapshot needs.
 * `currentTrack` is read to derive `currentIndex` against `playlist`.
 */
export interface PlayerStateSource {
  playlist: Track[];
  currentTrack: Track | null;
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  diskUsage: number;
  queue: string[];
  isMuted: boolean;
  volume: number;
  shuffle: boolean;
  repeatMode: 'none' | 'one' | 'all';
  playbackRate: number;
  crossfade: number;
  normalizeVolume: boolean;
  streamPlayback: boolean;
  sleepDeadline: number | null;
  eq: EqState;
  distortion: number;
  userPlaylists: Playlist[];
  wires: Wire[];
  unlinkedFolders: string[];
}

/** Project the live engine state into a flat, clone-safe snapshot. */
export function buildPlayerSnapshot(s: PlayerStateSource): PlayerSnapshot {
  return {
    playlist: s.playlist,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    progress: s.progress,
    duration: s.duration,
    diskUsage: s.diskUsage,
    queue: s.queue,
    isMuted: s.isMuted,
    volume: s.volume,
    shuffle: s.shuffle,
    repeatMode: s.repeatMode,
    playbackRate: s.playbackRate,
    crossfade: s.crossfade,
    normalizeVolume: s.normalizeVolume,
    streamPlayback: s.streamPlayback,
    sleepDeadline: s.sleepDeadline,
    eq: s.eq,
    distortion: s.distortion,
    userPlaylists: s.userPlaylists,
    wires: s.wires,
    unlinkedFolders: s.unlinkedFolders,
  };
}
