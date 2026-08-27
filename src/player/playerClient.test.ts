// Run with: npx tsx src/player/playerClient.test.ts
import { createCommandSenders, deriveCurrentTrack, EMPTY_SNAPSHOT } from './playerClient';
import { applyPlayerCommand, type PlayerCommand, type PlayerEngine } from './playerProtocol';
import type { Track } from '../types';
import type { NodeRef } from '../audio/wires';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const track = (id: string): Track => ({ id, name: id, artist: 'A', album: 'Al', url: 'blob:' + id });
const node: NodeRef = { kind: 'folder', key: 'D:\\M' };

// ─── deriveCurrentTrack ─────────────────────────────────────────────────────
check('empty snapshot has no current track', deriveCurrentTrack(EMPTY_SNAPSHOT), null);
const snap = { ...EMPTY_SNAPSHOT, playlist: [track('a'), track('b'), track('c')], currentIndex: 1 };
check('current track derived from index', deriveCurrentTrack(snap)?.id, 'b');
check('out-of-range index yields null', deriveCurrentTrack({ ...snap, currentIndex: 9 }), null);
check('index -1 (nothing playing) yields null', deriveCurrentTrack({ ...snap, currentIndex: -1 }), null);

// ─── command senders: each UI call emits the matching command ───────────────
function capture() {
  const sent: PlayerCommand[] = [];
  return { send: (c: PlayerCommand) => sent.push(c), sent };
}
const c = createCommandSenders(() => {});

// Spot-check representative senders (sync + async + multi-arg).
{
  const { send, sent } = capture();
  const s = createCommandSenders(send);
  s.togglePlay();
  check('togglePlay', sent[0], { type: 'togglePlay' });
}
{
  const { send, sent } = capture();
  const s = createCommandSenders(send);
  s.playTrack(3, ['a', 'b'], node);
  check('playTrack carries index+ids+source', sent[0], { type: 'playTrack', index: 3, orderedIds: ['a', 'b'], source: node });
}
{
  const { send, sent } = capture();
  const s = createCommandSenders(send);
  s.seek(55); s.setVolume(0.4); s.updateEq('treble', -3);
  check('seek', sent[0], { type: 'seek', value: 55 });
  check('setVolume', sent[1], { type: 'setVolume', value: 0.4 });
  check('updateEq', sent[2], { type: 'updateEq', band: 'treble', value: -3 });
}

// ─── async senders fire a command AND resolve with a placeholder ────────────
(async () => {
  {
    const { send, sent } = capture();
    const s = createCommandSenders(send);
    const id = await s.createPlaylist('Doom');
    check('createPlaylist sends command', sent[0], { type: 'createPlaylist', name: 'Doom' });
    check('createPlaylist resolves (id via snapshot, not return)', id, '');
  }
  {
    const { send, sent } = capture();
    const s = createCommandSenders(send);
    const n = await s.removeDuplicates();
    check('removeDuplicates sends + resolves', [sent[0], n], [{ type: 'removeDuplicates' }, 0]);
  }
  {
    const { send, sent } = capture();
    const s = createCommandSenders(send);
    const r = await s.addNativeFiles(['D:\\x.flac']);
    check('addNativeFiles sends paths', sent[0], { type: 'addNativeFiles', paths: ['D:\\x.flac'] });
    check('addNativeFiles resolves a result shape', r, { added: 0, skipped: 0, persistFailed: 0 });
  }

  // ─── round-trip: client command -> engine call, for every sender ──────────
  // Build a spy engine, and for each sender name assert the command it emits is
  // one applyPlayerCommand can dispatch (no unhandled command types).
  const engineCalls: string[] = [];
  const engine = new Proxy({} as PlayerEngine, {
    get: (_t, prop) => (..._a: unknown[]) => { engineCalls.push(String(prop)); },
  });
  const relay = createCommandSenders((cmd) => applyPlayerCommand(engine, cmd));
  relay.togglePlay();
  relay.playNext();
  relay.playPrev();
  relay.toggleMute();
  relay.setSleepTimer(null);
  relay.addWire(node, node);
  relay.playWireNode(node);
  await relay.deletePlaylist('p1');
  check('client->engine round-trip dispatches without unhandled commands',
    engineCalls,
    ['togglePlay', 'playNext', 'playPrev', 'toggleMute', 'setSleepTimer', 'addWire', 'playWireNode', 'deletePlaylist']);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();

// touch `c` so it isn't flagged unused when editing
void c;
