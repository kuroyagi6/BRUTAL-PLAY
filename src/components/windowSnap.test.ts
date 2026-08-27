// Run with: npx tsx src/components/windowSnap.test.ts
import { rectForTarget, edgeTargetFromPoint } from './windowSnap';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── rects: halves tile edge-to-edge with no gap/overlap ────────────────────
const W = 1000, H = 600;
const left = rectForTarget('left', W, H);
const right = rectForTarget('right', W, H);
check('left starts at origin', [left.x, left.y], [0, 0]);
check('left+right widths fill W', left.width + right.width, W);
check('right starts where left ends', right.x, left.width);
check('left is full height', left.height, H);

const top = rectForTarget('top', W, H);
const bottom = rectForTarget('bottom', W, H);
check('top+bottom heights fill H', top.height + bottom.height, H);
check('bottom starts where top ends', bottom.y, top.height);

// Quadrants cover the whole area with no overlap.
const tl = rectForTarget('top-left', W, H);
const tr = rectForTarget('top-right', W, H);
const bl = rectForTarget('bottom-left', W, H);
const br = rectForTarget('bottom-right', W, H);
const area = tl.width * tl.height + tr.width * tr.height + bl.width * bl.height + br.width * br.height;
check('four quadrants cover full area', area, W * H);
check('maximize fills area', rectForTarget('maximize', W, H), { x: 0, y: 0, width: W, height: H });

// ─── edge detection ─────────────────────────────────────────────────────────
check('cursor at left middle -> left', edgeTargetFromPoint(5, 300, W, H), 'left');
check('cursor at right middle -> right', edgeTargetFromPoint(995, 300, W, H), 'right');
check('cursor at left top corner -> top-left', edgeTargetFromPoint(5, 10, W, H), 'top-left');
check('cursor at right bottom corner -> bottom-right', edgeTargetFromPoint(995, 590, W, H), 'bottom-right');
check('cursor at top middle -> maximize', edgeTargetFromPoint(500, 5, W, H), 'maximize');
check('cursor in the middle -> null', edgeTargetFromPoint(500, 300, W, H), null);
check('degenerate area -> null', edgeTargetFromPoint(0, 0, 0, 0), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
