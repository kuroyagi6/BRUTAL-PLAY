// Run with: npx tsx src/utils/lrc.test.ts
import { parseTimestampedLyrics, resolveSyncedLyrics } from './lrc';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

check('plain text (no tokens) → empty', parseTimestampedLyrics('just some words\nno stamps'), []);

check('strips token, keeps text', parseTimestampedLyrics('[00:12.50]hello world'), [
  { text: 'hello world', timestamp: 12.5 },
]);

check('2-digit centiseconds', parseTimestampedLyrics('[01:02.30]x')[0].timestamp, 62.3);
check('3-digit milliseconds', parseTimestampedLyrics('[00:01.500]x')[0].timestamp, 1.5);
check('1-digit tenths', parseTimestampedLyrics('[00:01.5]x')[0].timestamp, 1.5);
check('no fraction → whole second', parseTimestampedLyrics('[00:05]x')[0].timestamp, 5);
check('colon fraction separator', parseTimestampedLyrics('[00:05:20]x')[0].timestamp, 5.2);

check('sorted across lines', parseTimestampedLyrics('[00:09.00]b\n[00:03.00]a').map((l) => l.text), ['a', 'b']);

// A line can carry several timestamps (repeated chorus) → one entry per stamp.
check('multiple stamps per line', parseTimestampedLyrics('[00:01.00][00:04.00]chorus'), [
  { text: 'chorus', timestamp: 1 },
  { text: 'chorus', timestamp: 4 },
]);

// ─── resolveSyncedLyrics: what actually gets followed on screen ─────────────
check('null track → null', resolveSyncedLyrics(null), null);
check('real syncedLyrics win', resolveSyncedLyrics({ syncedLyrics: [{ text: 'a', timestamp: 1 }] }), [{ text: 'a', timestamp: 1 }]);
// The bug from the screenshot: timestamped text stored as PLAIN lyrics must still follow.
check('timestamped plain lyrics are parsed', resolveSyncedLyrics({ lyrics: '[00:02.67]YOU\'RE A BUTTERFLY' }), [
  { text: "YOU'RE A BUTTERFLY", timestamp: 2.67 },
]);
check('plain lyrics without stamps → null (shown as-is)', resolveSyncedLyrics({ lyrics: 'no timestamps here' }), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
