// Run with: npx tsx src/audio/wires.test.ts
import { addWire, removeWire, removeNode, nextNode, prevNode, wouldCycle, sameNode, chainOrder, type Wire, type NodeRef } from './wires';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const F = (k: string): NodeRef => ({ kind: 'folder', key: k });
const P = (k: string): NodeRef => ({ kind: 'playlist', key: k });
const w = (from: NodeRef, to: NodeRef): Wire => ({ from, to, type: 'continuous' });

// Build a chain A -> B -> C.
let g: Wire[] = [];
g = addWire(g, w(F('A'), F('B')));
g = addWire(g, w(F('B'), F('C')));

check('chain length', g.length, 2);
check('next of A is B', nextNode(g, F('A')), F('B'));
check('next of C is none', nextNode(g, F('C')), null);
check('prev of C is B (rewind)', prevNode(g, F('C')), F('B'));
check('prev of A is none', prevNode(g, F('A')), null);

// Cross-kind keys don't collide: folder "A" != playlist "A".
check('folder A and playlist A are distinct nodes', sameNode(F('A'), P('A')), false);
check('next of playlist A is none', nextNode(g, P('A')), null);

// One-out AND one-in constraint together: re-dragging A->C drops A's old
// out-edge (A->B) AND C's old in-edge (B->C), leaving just A->C.
let g2 = addWire(g, w(F('A'), F('C')));
check('re-wiring A->C collapses to a single wire', g2.length, 1);
check('A now points to C', nextNode(g2, F('A')), F('C'));
check('B is now orphaned (no in-edge)', prevNode(g2, F('B')), null);

// Pure one-out retarget (no in-edge conflict): A->B becomes A->D.
let g2b = addWire(g, w(F('A'), F('D')));
check('re-wiring A->D keeps both wires', g2b.length, 2);
check('A now points to D', nextNode(g2b, F('A')), F('D'));

// One-in constraint: wiring X->C replaces B->C.
let g3 = addWire(g, w(F('X'), F('C')));
check('re-wiring into C replaces its in-edge (still 2)', g3.length, 2);
check('C now fed by X', prevNode(g3, F('C')), F('X'));

// Self-wire rejected.
check('self-wire rejected', addWire(g, w(F('A'), F('A'))).length, 2);

// Cycles allowed: close C -> A.
let loop = addWire(g, w(F('C'), F('A')));
check('cycle allowed (3 wires)', loop.length, 3);
check('next of C is A (looped)', nextNode(loop, F('C')), F('A'));
check('wouldCycle detects the loop before adding', wouldCycle(g, F('C'), F('A')), true);
check('wouldCycle false for non-looping edge', wouldCycle(g, F('C'), F('D')), false);

// removeWire / removeNode.
check('removeWire drops the edge', removeWire(g, F('A'), F('B')).length, 1);
check('removeNode B clears both its edges', removeNode(g, F('B')).length, 0);

// chainOrder: A -> B -> C numbers 1,2,3 (A is the head / starting point).
const ord = chainOrder(g);
check('order A=1 (start)', ord.get('folder:A'), 1);
check('order B=2', ord.get('folder:B'), 2);
check('order C=3', ord.get('folder:C'), 3);
check('unwired node has no order', ord.get('folder:Z'), undefined);

// Two independent chains each start at 1.
let two = addWire(addWire([], w(F('A'), F('B'))), w(P('X'), P('Y')));
const ord2 = chainOrder(two);
check('second chain head also = 1', ord2.get('playlist:X'), 1);
check('second chain tail = 2', ord2.get('playlist:Y'), 2);

// Headless cycle still gets numbered.
const ordLoop = chainOrder(loop); // A->B->C->A
check('cycle still numbered from a start', ordLoop.get('folder:A'), 1);
check('cycle covers all nodes', ordLoop.size, 3);

// Immutability: none of the above mutated g.
check('original graph untouched', g.length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
