// Run with: npx tsx src/audio/queue.test.ts
import { pickAdjacent, isLastInQueue, reconcileCurrentId } from './queue';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${got} want=${want}`);
  ok ? pass++ : fail++;
}

// Master (import) order D,A,C,B but the user sorted the view A,B,C,D.
const master = ['D', 'A', 'C', 'B'];
const sorted = ['A', 'B', 'C', 'D'];
const next = (curId: string | null, queue = sorted, shuffle = false) =>
  pickAdjacent({ masterIds: master, queue, currentId: curId, dir: 1, shuffle });
const prev = (curId: string | null, queue = sorted) =>
  pickAdjacent({ masterIds: master, queue, currentId: curId, dir: -1, shuffle: false });

// The core bug: next must follow the sorted view, not master order.
check('next after A follows sorted', next('A'), 'B');
check('next after B follows sorted', next('B'), 'C');
check('prev after C follows sorted', prev('C'), 'B');
check('next wraps at end', next('D'), 'A');
check('prev wraps at start', prev('A'), 'D');

// Album view: only B and C, in that order.
check('album next stays in album', next('B', ['B', 'C']), 'C');
check('album next wraps within album', next('C', ['B', 'C']), 'B');

// A removed track in the queue is filtered out.
check('stale id filtered out', next('A', ['A', 'X', 'B']), 'B');

// Empty queue falls back to master order.
check('empty queue -> master order', next('D', []), 'A');

// Shuffle avoids replaying the same track (deterministic RNG hitting current).
check(
  'shuffle avoids same track',
  pickAdjacent({ masterIds: master, queue: sorted, currentId: 'A', dir: 1, shuffle: true, random: () => 0 }),
  'B'
);

// End-of-queue detection (drives repeat-off stop).
check('D is last in sorted queue', isLastInQueue(master, sorted, 'D'), true);
check('A is not last in sorted queue', isLastInQueue(master, sorted, 'A'), false);
check('C is last in album queue', isLastInQueue(master, ['B', 'C'], 'C'), true);

// reconcileCurrentId: keep current track if present, else first, else null.
check('reconcile keeps present current', reconcileCurrentId(['A', 'B', 'C'], 'B'), 'B');
check('reconcile falls back to first when removed', reconcileCurrentId(['A', 'B', 'C'], 'X'), 'A');
check('reconcile picks first when none set', reconcileCurrentId(['A', 'B'], null), 'A');
check('reconcile empty library -> null', reconcileCurrentId([], 'A'), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
