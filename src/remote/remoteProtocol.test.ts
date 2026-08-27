// Run: npx tsx src/remote/remoteProtocol.test.ts
// Covers the command->transport mapping and the JSON coercion, the two pieces
// that sit between the untrusted network and the audio engine.

import assert from 'assert';
import {
  applyRemoteCommand,
  parseRemoteCommand,
  buildRemoteState,
  buildRemoteLibrary,
  buildRemoteVideoLibrary,
  type RemoteTransport,
} from './remoteProtocol';
import type { Track, VideoItem } from '../types';

function spyTransport(isPlaying: boolean) {
  const calls: string[] = [];
  const t: RemoteTransport = {
    isPlaying,
    togglePlay: () => calls.push('toggle'),
    playNext: () => calls.push('next'),
    playPrev: () => calls.push('prev'),
    seek: (n) => calls.push('seek:' + n),
    setVolume: (n) => calls.push('vol:' + n),
    toggleMute: () => calls.push('mute'),
    toggleShuffle: () => calls.push('shuffle'),
    toggleRepeat: () => calls.push('repeat'),
    playTrackId: (id) => calls.push('play:' + id),
  };
  return { t, calls };
}

// play/pause are derived from togglePlay + current state.
{
  const paused = spyTransport(false);
  applyRemoteCommand({ type: 'play' }, paused.t);
  assert.deepStrictEqual(paused.calls, ['toggle'], 'play while paused toggles');

  const playing = spyTransport(true);
  applyRemoteCommand({ type: 'play' }, playing.t);
  assert.deepStrictEqual(playing.calls, [], 'play while already playing is a no-op');

  const p2 = spyTransport(true);
  applyRemoteCommand({ type: 'pause' }, p2.t);
  assert.deepStrictEqual(p2.calls, ['toggle'], 'pause while playing toggles');

  const p3 = spyTransport(false);
  applyRemoteCommand({ type: 'pause' }, p3.t);
  assert.deepStrictEqual(p3.calls, [], 'pause while paused is a no-op');
}

// next/prev/mute/toggle/shuffle/repeat map straight through.
{
  const s = spyTransport(true);
  applyRemoteCommand({ type: 'next' }, s.t);
  applyRemoteCommand({ type: 'prev' }, s.t);
  applyRemoteCommand({ type: 'mute' }, s.t);
  applyRemoteCommand({ type: 'toggle' }, s.t);
  applyRemoteCommand({ type: 'shuffle' }, s.t);
  applyRemoteCommand({ type: 'repeat' }, s.t);
  assert.deepStrictEqual(s.calls, ['next', 'prev', 'mute', 'toggle', 'shuffle', 'repeat']);
}

// volume is clamped to 0..1; seek floored at 0; non-finite ignored.
{
  const s = spyTransport(true);
  applyRemoteCommand({ type: 'volume', value: 2 }, s.t);
  applyRemoteCommand({ type: 'volume', value: -1 }, s.t);
  applyRemoteCommand({ type: 'volume', value: 0.5 }, s.t);
  applyRemoteCommand({ type: 'seek', value: -5 }, s.t);
  applyRemoteCommand({ type: 'seek', value: 42 }, s.t);
  applyRemoteCommand({ type: 'seek', value: NaN }, s.t);
  assert.deepStrictEqual(s.calls, ['vol:1', 'vol:0', 'vol:0.5', 'seek:0', 'seek:42']);
}

// playTrack drives playTrackId; empty/blank ids are ignored.
{
  const s = spyTransport(false);
  applyRemoteCommand({ type: 'playTrack', value: 'trk-9' }, s.t);
  applyRemoteCommand({ type: 'playTrack', value: '' }, s.t);
  assert.deepStrictEqual(s.calls, ['play:trk-9']);
}

// parseRemoteCommand rejects junk and coerces numeric fields.
{
  assert.strictEqual(parseRemoteCommand(null), null);
  assert.strictEqual(parseRemoteCommand({ type: 'explode' }), null);
  assert.deepStrictEqual(parseRemoteCommand({ type: 'next' }), { type: 'next' });
  assert.deepStrictEqual(parseRemoteCommand({ type: 'shuffle' }), { type: 'shuffle' });
  assert.deepStrictEqual(parseRemoteCommand({ type: 'repeat' }), { type: 'repeat' });
  assert.deepStrictEqual(parseRemoteCommand({ type: 'seek', value: '12' }), { type: 'seek', value: 12 });
  assert.deepStrictEqual(parseRemoteCommand({ type: 'volume', value: 0.3 }), { type: 'volume', value: 0.3 });
  assert.deepStrictEqual(parseRemoteCommand({ type: 'playTrack', value: 'abc' }), { type: 'playTrack', value: 'abc' });
  assert.strictEqual(parseRemoteCommand({ type: 'playTrack', value: '' }), null);
  assert.strictEqual(parseRemoteCommand({ type: 'playTrack' }), null);
}

// buildRemoteState / buildRemoteLibrary shape.
{
  const track: Track = {
    id: 'a1', name: 'Song', artist: 'Band', album: 'Rec', url: 'blob:x',
    duration: 200, nativePath: 'C:\\music\\song.mp3',
  };
  const state = buildRemoteState({
    currentTrack: track, isPlaying: true, progress: 10, duration: 200, volume: 0.8, isMuted: false,
    isShuffle: true, repeatMode: 'all',
  });
  assert.strictEqual(state.trackId, 'a1');
  assert.strictEqual(state.name, 'Song');
  assert.strictEqual(state.isPlaying, true);
  assert.strictEqual(state.isShuffle, true);
  assert.strictEqual(state.repeatMode, 'all');

  const empty = buildRemoteState({
    currentTrack: null, isPlaying: false, progress: 0, duration: 0, volume: 1, isMuted: true,
    isShuffle: false, repeatMode: 'none',
  });
  assert.strictEqual(empty.trackId, null);
  assert.strictEqual(empty.name, '');

  const lib = buildRemoteLibrary([track]);
  assert.strictEqual(lib.length, 1);
  assert.strictEqual(lib[0].nativePath, 'C:\\music\\song.mp3');
  assert.strictEqual(lib[0].id, 'a1');
}

// buildRemoteVideoLibrary derives a lower-case ext (drives the phone codec hint).
{
  const vids: VideoItem[] = [
    { id: 'v1', name: 'Clip', url: 'local-media://x', nativePath: 'D:\\vids\\Clip.MP4', duration: 90 },
    { id: 'v2', name: 'Home', url: 'local-media://y', nativePath: 'D:\\vids\\home.mkv' },
    { id: 'v3', name: 'NoExt', url: 'local-media://z', nativePath: 'D:\\vids\\NoExt' },
  ];
  const out = buildRemoteVideoLibrary(vids);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].ext, '.mp4', 'extension lower-cased');
  assert.strictEqual(out[0].nativePath, 'D:\\vids\\Clip.MP4', 'path kept for streaming');
  assert.strictEqual(out[1].ext, '.mkv');
  assert.strictEqual(out[2].ext, '', 'no dot => empty ext');
}

console.log('remoteProtocol.test.ts: all assertions passed');
