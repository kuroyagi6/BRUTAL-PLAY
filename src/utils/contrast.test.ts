// Run with: npx tsx src/utils/contrast.test.ts
import { parseColor, readableOn } from './contrast';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

check('parse #rrggbb', parseColor('#C1272D'), [193, 39, 45]);
check('parse #rgb shorthand', parseColor('#fff'), [255, 255, 255]);
check('parse rgb()', parseColor('rgb(20, 16, 14)'), [20, 16, 14]);
check('parse garbage → null', parseColor('not-a-color'), null);

// The whole point: the default red accent must NOT get black text.
check('soviet red → white text', readableOn('#C1272D'), '#FFFFFF');
check('near-black → white text', readableOn('#14100E'), '#FFFFFF');
check('cream → black text', readableOn('#E8E2D0'), '#000000');
check('bright yellow → black text', readableOn('#FFD400'), '#000000');
check('bright green → black text', readableOn('#00FF41'), '#000000');
check('deep blue → white text', readableOn('#0055FF'), '#FFFFFF');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
