// Run with: npx tsx src/player/visualizerFrame.test.ts
import { packVizFrame, unpackVizFrame, emptyVizFrames, VIZ_FREQ_LEN, VIZ_TIME_LEN } from './visualizerFrame';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
const arr = (n: number, f: (i: number) => number) => Array.from(new Uint8Array(n).map((_, i) => f(i)));

// ─── pack: freq then time, one flat buffer ──────────────────────────────────
// NOTE: the halves are DIFFERENT lengths now — freq carries log-spaced bands,
// time carries a longer trace — so the split point is VIZ_FREQ_LEN, not len/2.
const freq = Uint8Array.from(arr(VIZ_FREQ_LEN, (i) => i % 256));
const time = Uint8Array.from(arr(VIZ_TIME_LEN, (i) => (255 - i) % 256));
const packed = packVizFrame(freq, time);
check('packed length = freq + time', packed.length, VIZ_FREQ_LEN + VIZ_TIME_LEN);
check('packed head is frequency bands', Array.from(packed.subarray(0, VIZ_FREQ_LEN)), Array.from(freq));
check('packed tail is time-domain', Array.from(packed.subarray(VIZ_FREQ_LEN)), Array.from(time));

// ─── unpack: round-trips into a STABLE container (same refs) ─────────────────
const into = emptyVizFrames();
const freqRef = into.frequency;
const timeRef = into.timeDomain;
unpackVizFrame(packed, into);
check('unpacked frequency matches', Array.from(into.frequency), Array.from(freq));
check('unpacked timeDomain matches', Array.from(into.timeDomain), Array.from(time));
check('container arrays are mutated in place, not replaced (frequency)', into.frequency === freqRef, true);
check('container arrays are mutated in place, not replaced (timeDomain)', into.timeDomain === timeRef, true);

// Asymmetric split is the whole point — assert it explicitly so a future change
// back to a midpoint split fails loudly instead of silently shifting the scope.
check('frequency half is the band count', into.frequency.length, VIZ_FREQ_LEN);
check('time half is longer than the frequency half', into.timeDomain.length > into.frequency.length, true);

// ─── tolerance: a short frame copies what fits, no throw ─────────────────────
const into2 = emptyVizFrames();
unpackVizFrame(new Uint8Array(10), into2); // 10 freq bytes, no time bytes
check('short frame leaves trailing bytes zero', into2.frequency[VIZ_FREQ_LEN - 1], 0);
check('short frame does not throw and fills nothing wrong', into2.timeDomain[0], 0);

// ─── a full frame is small enough for 30fps streaming ───────────────────────
check('frame is 320 bytes (~9.6 KB/s at 30fps)', packed.length, 320);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
