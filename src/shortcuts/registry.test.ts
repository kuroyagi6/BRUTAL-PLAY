// Run with: npx tsx src/shortcuts/registry.test.ts
import {
  DEFAULT_SHORTCUTS,
  displayToken,
  eventToToken,
  matchAction,
  normalizeConfig,
  withBinding,
} from './registry';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── token normalization ───────────────────────────────────────────────────
check('space via key', eventToToken({ key: ' ' }), 'Space');
check('space via code', eventToToken({ key: 'Unidentified', code: 'Space' }), 'Space');
check('letter lowercased', eventToToken({ key: 'N' }), 'n');
check('question mark kept', eventToToken({ key: '?' }), '?');
check('arrow kept verbatim', eventToToken({ key: 'ArrowLeft' }), 'ArrowLeft');

check('display space', displayToken('Space'), 'SPACE');
check('display arrow', displayToken('ArrowRight'), '→');
check('display letter', displayToken('m'), 'M');

// ─── defaults / matching ────────────────────────────────────────────────────
check('space plays', matchAction(DEFAULT_SHORTCUTS, 'Space'), 'playPause');
check('left is prev', matchAction(DEFAULT_SHORTCUTS, 'ArrowLeft'), 'prev');
check('right is next', matchAction(DEFAULT_SHORTCUTS, 'ArrowRight'), 'next');
check('up maximizes', matchAction(DEFAULT_SHORTCUTS, 'ArrowUp'), 'maximize');
check('down minimizes', matchAction(DEFAULT_SHORTCUTS, 'ArrowDown'), 'minimize');
check('insert restores', matchAction(DEFAULT_SHORTCUTS, 'Insert'), 'restore');
check('delete closes', matchAction(DEFAULT_SHORTCUTS, 'Delete'), 'close');
check('unbound token', matchAction(DEFAULT_SHORTCUTS, 'z'), null);

// Every default binding is unique — no two actions on one key.
const defaultTokens = Object.values(DEFAULT_SHORTCUTS);
check('all default tokens unique', defaultTokens.length, new Set(defaultTokens).size);

// ─── normalizeConfig merges over defaults ───────────────────────────────────
check('missing action filled from defaults', normalizeConfig({ mute: 'x' }).theme, 't');
check('stored override wins', normalizeConfig({ mute: 'x' }).mute, 'x');
check('null → all defaults', normalizeConfig(null), DEFAULT_SHORTCUTS);

// ─── withBinding: rebind + swap ─────────────────────────────────────────────
const rebound = withBinding(DEFAULT_SHORTCUTS, 'mute', 'k');
check('simple rebind to a free key', rebound.mute, 'k');
check('no-op when unchanged', withBinding(DEFAULT_SHORTCUTS, 'mute', 'm'), DEFAULT_SHORTCUTS);

// Binding next -> Space (owned by playPause) swaps: playPause takes next's old key.
const swapped = withBinding(DEFAULT_SHORTCUTS, 'next', 'Space');
check('taker gets the key', swapped.next, 'Space');
check('previous owner gets the takers old key', swapped.playPause, 'ArrowRight');
// Every token still unique after a swap.
const tokens = Object.values(swapped);
check('no duplicate tokens after swap', tokens.length, new Set(tokens).size);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
