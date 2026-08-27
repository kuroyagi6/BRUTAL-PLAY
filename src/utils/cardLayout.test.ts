// Run: npx tsx src/utils/cardLayout.test.ts
// No canvas: the measure function is injected, so "width" here is just
// characters × size, which makes every expectation countable by hand.
import { wrapText, fitFontSize, cardFileName, CARD_SIZES } from './cardLayout';

let passed = 0;
const fail: string[] = [];

function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else fail.push(`${what}\n    expected: ${e}\n    actual:   ${a}`);
}
function ok(cond: boolean, what: string) {
  if (cond) passed++;
  else fail.push(what);
}

/** Every glyph is exactly `size` wide — so a 10-char string at size 2 is 20px. */
const measure = (text: string, size: number) => text.length * size;

// --- wrapping ----------------------------------------------------------------
eq(wrapText('', 10, 100, measure), [], 'empty text wraps to nothing');
eq(wrapText('   ', 10, 100, measure), [], 'whitespace-only wraps to nothing');
eq(wrapText('one two', 1, 100, measure), ['one two'], 'text that fits stays on one line');
eq(wrapText('aaa bbb ccc', 1, 7, measure), ['aaa bbb', 'ccc'], 'wraps at the last word that fits');
eq(wrapText('aaa   bbb', 1, 100, measure), ['aaa bbb'], 'runs of whitespace collapse to one space');

// A single word wider than the line gets its own line rather than being broken.
eq(
  wrapText('supercalifragilistic ok', 1, 5, measure),
  ['supercalifragilistic', 'ok'],
  'an over-wide word is not broken mid-word'
);

// --- fitting -----------------------------------------------------------------
{
  // 10 chars, 100px wide, so size 10 fits exactly on one line; height 10*1.2=12.
  const r = fitFontSize(['abcdefghij'], {
    maxWidth: 100, maxHeight: 100, lineHeight: 1.2, min: 2, max: 20, measure,
  });
  eq(r.fontSize, 10, 'picks the largest size that fits the width');
  eq(r.lines, ['abcdefghij'], 'and lays it out on one line');
  eq(r.overflow, false, 'no overflow');
}

{
  // Height is the binding constraint: 4 paragraphs at size 10 = 48px > 30px.
  const r = fitFontSize(['aa', 'bb', 'cc', 'dd'], {
    maxWidth: 1000, maxHeight: 30, lineHeight: 1.2, min: 2, max: 20, measure,
  });
  ok(r.lines.length * r.fontSize * 1.2 <= 30, 'shrinks until the block fits the height');
  eq(r.overflow, false, 'a size that fits was found');
}

{
  // Blank entries are verse gaps and must survive, or the quote reflows.
  const r = fitFontSize(['first', '', 'second'], {
    maxWidth: 1000, maxHeight: 1000, lineHeight: 1.2, min: 2, max: 20, measure,
  });
  eq(r.lines, ['first', '', 'second'], 'blank lines are preserved');
}

{
  // Impossible box: report overflow at the minimum rather than looping forever.
  const r = fitFontSize(['a very long line indeed'], {
    maxWidth: 4, maxHeight: 4, lineHeight: 1.2, min: 2, max: 20, measure,
  });
  eq(r.fontSize, 2, 'falls back to the minimum size');
  eq(r.overflow, true, 'and reports that it still overflows');
  ok(r.lines.length > 0, 'still returns lines to draw');
}

{
  // An unbroken word wider than the card must force a shrink, not bleed off the
  // edge: 20 chars in a 100px box only fits at size 5.
  const r = fitFontSize(['abcdefghijklmnopqrst'], {
    maxWidth: 100, maxHeight: 1000, lineHeight: 1.2, min: 2, max: 20, measure, step: 1,
  });
  eq(r.fontSize, 5, 'shrinks until an unbreakable word fits the width');
  ok(measure(r.lines[0], r.fontSize) <= 100, 'and the drawn line is inside the box');
}

{
  // The step must not skip past a fitting size and report a smaller one.
  const r = fitFontSize(['abcd'], {
    maxWidth: 40, maxHeight: 1000, lineHeight: 1.2, min: 2, max: 10, measure, step: 1,
  });
  eq(r.fontSize, 10, 'a size that fits at the maximum is taken immediately');
}

// --- card sizes --------------------------------------------------------------
ok(CARD_SIZES.length === 3, 'three card ratios offered');
ok(CARD_SIZES.every((s) => s.width > 0 && s.height > 0), 'every ratio has real dimensions');
ok(new Set(CARD_SIZES.map((s) => s.id)).size === 3, 'card size ids are unique');

// --- filenames ---------------------------------------------------------------
eq(cardFileName('Nas', 'One Mic', 'square'), 'Nas - One Mic (square).png', 'plain name passes through');
eq(cardFileName('AC/DC', 'T.N.T.', 'square'), 'ACDC - T.N.T (square).png', 'illegal characters are dropped');
ok(!/[<>:"/\\|?*]/.test(cardFileName('a<b>c:d"e/f\\g|h?i*j', 'k', 'square').replace(/\.png$/, '')),
  'no reserved character survives');
eq(cardFileName('  Spaced  Out  ', 'Song', 'square'), 'Spaced Out - Song (square).png', 'whitespace is tidied, not stripped');
eq(cardFileName('', '', 'square'), 'untitled - untitled (square).png', 'empty tags fall back to untitled');
eq(cardFileName('Trailing.', 'Dot.', 'square'), 'Trailing - Dot (square).png', 'trailing dots are trimmed off each part');
ok(cardFileName('x'.repeat(200), 'y'.repeat(200), 'square').length < 160, 'long tags are truncated');
// Control characters (a stray newline in a tag) must not reach the filesystem.
eq(cardFileName('A\nB', 'C\tD', 'square'), 'AB - CD (square).png', 'control characters are removed');

if (fail.length) {
  console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
  for (const f of fail) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`  cardLayout: ${passed} assertions passed`);
