// Run with: npx tsx src/player/playerProtocol.test.ts
import {
  applyPlayerCommand,
  applyProgress,
  buildPlayerSnapshot,
  buildProgress,
  type PlayerCommand,
  type PlayerEngine,
  type PlayerStateSource,
} from './playerProtocol';
import type { Track, Playlist } from '../types';
import type { Wire, NodeRef } from '../audio/wires';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── a spy engine records every call as [method, ...args] ───────────────────
function spyEngine() {
  const calls: unknown[][] = [];
  const rec = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const engine: PlayerEngine = {
    togglePlay: rec('togglePlay'),
    playTrack: rec('playTrack'),
    playNext: rec('playNext'),
    playPrev: rec('playPrev'),
    seek: rec('seek'),
    setVolume: rec('setVolume'),
    toggleMute: rec('toggleMute'),
    toggleShuffle: rec('toggleShuffle'),
    toggleRepeat: rec('toggleRepeat'),
    setPlaybackRate: rec('setPlaybackRate'),
    setCrossfade: rec('setCrossfade'),
    setNormalizeVolume: rec('setNormalizeVolume'),
    setStreamPlayback: rec('setStreamPlayback'),
    setSleepTimer: rec('setSleepTimer'),
    updateEq: rec('updateEq'),
    updateDistortion: rec('updateDistortion'),
    removeTrack: rec('removeTrack'),
    removeDuplicates: rec('removeDuplicates'),
    updateTrackDetails: rec('updateTrackDetails'),
    addNativeFiles: rec('addNativeFiles'),
    createPlaylist: rec('createPlaylist'),
    renamePlaylist: rec('renamePlaylist'),
    addTrackToPlaylist: rec('addTrackToPlaylist'),
    removeTrackFromPlaylist: rec('removeTrackFromPlaylist'),
    deletePlaylist: rec('deletePlaylist'),
    addWire: rec('addWire'),
    removeWire: rec('removeWire'),
    removeNodeWires: rec('removeNodeWires'),
    toggleFolderLink: rec('toggleFolderLink'),
    playWireNode: rec('playWireNode'),
  };
  return { engine, calls };
}

const node: NodeRef = { kind: 'folder', key: 'D:\\Music' };
const node2: NodeRef = { kind: 'playlist', key: 'pl-1' };

// ─── each command dispatches to the matching engine method with its args ────
const cases: Array<[PlayerCommand, unknown[]]> = [
  [{ type: 'togglePlay' }, ['togglePlay']],
  [{ type: 'playTrack', index: 5, orderedIds: ['a', 'b'], source: node }, ['playTrack', 5, ['a', 'b'], node]],
  [{ type: 'playTrack', index: 2 }, ['playTrack', 2, undefined, undefined]],
  [{ type: 'playNext' }, ['playNext']],
  [{ type: 'playPrev' }, ['playPrev']],
  [{ type: 'seek', value: 42 }, ['seek', 42]],
  [{ type: 'setVolume', value: 0.3 }, ['setVolume', 0.3]],
  [{ type: 'toggleMute' }, ['toggleMute']],
  [{ type: 'toggleShuffle' }, ['toggleShuffle']],
  [{ type: 'toggleRepeat' }, ['toggleRepeat']],
  [{ type: 'setPlaybackRate', value: 1.5 }, ['setPlaybackRate', 1.5]],
  [{ type: 'setCrossfade', value: 4 }, ['setCrossfade', 4]],
  [{ type: 'setNormalizeVolume', value: true }, ['setNormalizeVolume', true]],
  [{ type: 'setStreamPlayback', value: false }, ['setStreamPlayback', false]],
  [{ type: 'setSleepTimer', minutes: 30 }, ['setSleepTimer', 30]],
  [{ type: 'setSleepTimer', minutes: null }, ['setSleepTimer', null]],
  [{ type: 'updateEq', band: 'bass', value: 6 }, ['updateEq', 'bass', 6]],
  [{ type: 'updateDistortion', value: 20 }, ['updateDistortion', 20]],
  [{ type: 'removeTrack', trackId: 't1' }, ['removeTrack', 't1']],
  [{ type: 'removeDuplicates' }, ['removeDuplicates']],
  [{ type: 'updateTrackDetails', trackId: 't1', updates: { name: 'X' } }, ['updateTrackDetails', 't1', { name: 'X' }]],
  [{ type: 'addNativeFiles', paths: ['D:\\a.flac'] }, ['addNativeFiles', ['D:\\a.flac']]],
  [{ type: 'createPlaylist', name: 'Doom' }, ['createPlaylist', 'Doom']],
  [{ type: 'renamePlaylist', playlistId: 'p1', name: 'New' }, ['renamePlaylist', 'p1', 'New']],
  [{ type: 'addTrackToPlaylist', playlistId: 'p1', trackId: 't1' }, ['addTrackToPlaylist', 'p1', 't1']],
  [{ type: 'removeTrackFromPlaylist', playlistId: 'p1', trackId: 't1' }, ['removeTrackFromPlaylist', 'p1', 't1']],
  [{ type: 'deletePlaylist', playlistId: 'p1' }, ['deletePlaylist', 'p1']],
  [{ type: 'addWire', from: node, to: node2 }, ['addWire', node, node2]],
  [{ type: 'removeWire', from: node, to: node2 }, ['removeWire', node, node2]],
  [{ type: 'removeNodeWires', node }, ['removeNodeWires', node]],
  [{ type: 'toggleFolderLink', path: 'D:\\Music\\Sub' }, ['toggleFolderLink', 'D:\\Music\\Sub']],
  [{ type: 'playWireNode', node }, ['playWireNode', node]],
];

for (const [cmd, want] of cases) {
  const { engine, calls } = spyEngine();
  applyPlayerCommand(engine, cmd);
  check(`dispatch ${cmd.type}`, calls[0], want);
  check(`dispatch ${cmd.type} fires exactly once`, calls.length, 1);
}

// ─── every command survives a JSON round-trip (structured-clone-safe) ───────
for (const [cmd] of cases) {
  const round = JSON.parse(JSON.stringify(cmd));
  check(`${cmd.type} is clone-safe`, round, cmd);
}

// ─── buildPlayerSnapshot projects a flat, clone-safe snapshot ───────────────
const track = (id: string): Track => ({ id, name: id, artist: 'A', album: 'Al', url: 'blob:' + id });
const source: PlayerStateSource = {
  playlist: [track('t0'), track('t1'), track('t2')],
  currentTrack: track('t1'),
  currentIndex: 1,
  isPlaying: true,
  progress: 12,
  duration: 200,
  diskUsage: 999,
  queue: ['t0', 't1', 't2'],
  isMuted: false,
  volume: 0.8,
  shuffle: true,
  repeatMode: 'all',
  playbackRate: 1,
  crossfade: 2,
  normalizeVolume: true,
  streamPlayback: false,
  sleepDeadline: null,
  eq: { bass: 1, mid: 2, treble: 3 },
  distortion: 0,
  userPlaylists: [{ id: 'p1', name: 'P', trackIds: ['t0'], createdAt: 0 } as Playlist],
  wires: [{ from: node, to: node2, type: 'continuous' } as Wire],
  unlinkedFolders: ['d:\\music\\sub'],
};
const snap = buildPlayerSnapshot(source);
check('snapshot carries currentIndex, not currentTrack', 'currentIndex' in snap && !('currentTrack' in snap), true);
check('snapshot index matches', snap.currentIndex, 1);
check('snapshot keeps playlist length', snap.playlist.length, 3);
check('snapshot eq copied', snap.eq, { bass: 1, mid: 2, treble: 3 });
check('snapshot wires copied', snap.wires, [{ from: node, to: node2, type: 'continuous' }]);
check('snapshot is clone-safe', JSON.parse(JSON.stringify(snap)), snap);

// ─── progress patch: tiny, and merges without touching the heavy playlist ───
const prog = buildProgress(source);
check('progress patch has only the 4 high-rate fields', Object.keys(prog).sort(), ['currentIndex', 'duration', 'isPlaying', 'progress']);
check('progress patch carries no playlist', 'playlist' in prog, false);

const moved = applyProgress(snap, { progress: 99, duration: 300, currentIndex: 2, isPlaying: false });
check('applyProgress updates the 4 fields', [moved.progress, moved.duration, moved.currentIndex, moved.isPlaying], [99, 300, 2, false]);
check('applyProgress keeps the same playlist reference', moved.playlist === snap.playlist, true);
check('applyProgress leaves other fields intact', moved.volume, snap.volume);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
