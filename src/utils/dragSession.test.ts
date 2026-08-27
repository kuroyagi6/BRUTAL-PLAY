// Run with: npx tsx src/utils/dragSession.test.ts
import {
  NO_DRAG,
  withDragBegin,
  withDragEnd,
  isDragging,
  resolveDroppedTrackId,
} from './dragSession';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── state machine ──────────────────────────────────────────────────────────
check('nothing dragging initially', isDragging(NO_DRAG), false);
const dragging = withDragBegin('track-42');
check('begin records the track id', dragging.trackId, 'track-42');
check('begin means dragging', isDragging(dragging), true);
check('end clears', isDragging(withDragEnd()), false);

// ─── resolution: native (same-window) wins; session is the cross-window path ─
check('same-window drop uses native id', resolveDroppedTrackId('native-1', NO_DRAG), 'native-1');
check('cross-window drop (no native) falls back to session', resolveDroppedTrackId(null, dragging), 'track-42');
check('native wins even if a session is also active', resolveDroppedTrackId('native-1', dragging), 'native-1');
check('neither present -> null (not a track drop)', resolveDroppedTrackId(null, NO_DRAG), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
