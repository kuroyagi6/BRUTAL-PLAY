// Run with: node electron/localMediaProtocol.test.cjs
//
// parseRange is what makes seeking work. A media element scrubs by issuing
// Range requests; get the byte math wrong and playback either refuses to seek
// or serves the wrong bytes. These cases are the ones Chromium actually sends.
const { parseRange } = require('./localMediaProtocol.cjs');

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const SIZE = 1000;

// No Range header at all -> full-body 200 path.
check('absent range -> null', parseRange(undefined, SIZE), null);
check('empty range -> null', parseRange('', SIZE), null);

// The common cases.
check('closed range', parseRange('bytes=100-199', SIZE), { start: 100, end: 199 });
check('open-ended range', parseRange('bytes=100-', SIZE), { start: 100, end: 999 });
check('from zero', parseRange('bytes=0-', SIZE), { start: 0, end: 999 });
check('single byte', parseRange('bytes=0-0', SIZE), { start: 0, end: 0 });
check('last byte', parseRange('bytes=999-999', SIZE), { start: 999, end: 999 });

// Suffix range: "the last N bytes". Chromium uses this to read trailing
// metadata (e.g. an ID3v1 tag or a Matroska cue) before it will seek.
check('suffix range', parseRange('bytes=-500', SIZE), { start: 500, end: 999 });
check('suffix larger than file clamps to 0', parseRange('bytes=-5000', SIZE), { start: 0, end: 999 });

// End past EOF must clamp, not overrun.
check('end beyond eof clamps', parseRange('bytes=900-99999', SIZE), { start: 900, end: 999 });

// Unsatisfiable -> 416, never a bogus 206.
check('start at eof is unsatisfiable', parseRange('bytes=1000-', SIZE), { unsatisfiable: true });
check('start past eof is unsatisfiable', parseRange('bytes=5000-6000', SIZE), { unsatisfiable: true });
check('inverted range is unsatisfiable', parseRange('bytes=500-100', SIZE), { unsatisfiable: true });
check('empty file is unsatisfiable', parseRange('bytes=0-', 0), { unsatisfiable: true });

// A full-file request must cover exactly [0, size-1] — off-by-one here would
// truncate the last byte of every stream.
const full = parseRange('bytes=0-', SIZE);
check('full range length equals size', full.end - full.start + 1, SIZE);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
