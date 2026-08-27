// Run with: node electron/googleDrive.test.cjs
//
// safeFileName stands between a Drive filename and fs.writeFileSync. Drive lets a
// file be called almost anything — including characters Windows forbids and path
// separators — so a miss here is a failed write or, worse, a write outside the
// download folder.
const { safeFileName } = require('./googleDrive.cjs');

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// Ordinary names survive untouched — including the dots in an extension.
check('plain name', safeFileName('song.mp3'), 'song.mp3');
check('spaces and dashes kept', safeFileName('Antoine Waish - beats 78.m4a'), 'Antoine Waish - beats 78.m4a');
check('unicode kept', safeFileName('Antoiné Waish — beats.m4a'), 'Antoiné Waish — beats.m4a');

// Characters Windows rejects outright.
check('colon replaced', safeFileName('AC:DC.mp3'), 'AC_DC.mp3');
check('question mark replaced', safeFileName('what?.mp3'), 'what_.mp3');
check('quotes and pipes replaced', safeFileName('a"b|c*d.mp3'), 'a_b_c_d.mp3');
check('control chars replaced', safeFileName('badname.mp3'), 'bad_name.mp3');

// Path separators must never survive — this is the traversal guard.
check('forward slashes replaced', safeFileName('evil/../../boot.mp3'), 'evil_.._.._boot.mp3');
check('backslashes replaced', safeFileName('evil\\..\\boot.mp3'), 'evil_.._boot.mp3');
check('absolute path flattened', safeFileName('C:\\Windows\\System32\\x.dll'), 'C__Windows_System32_x.dll');
// A name that is nothing but dots would resolve to the folder itself.
// The whole leading dot-run collapses to a single '_', so '..' can never
// resolve to the parent directory.
check('leading dots neutralized', safeFileName('..'), '_');
check('deep traversal neutralized', safeFileName('...\\..\\x.mp3'), '__.._x.mp3');
check('dotfile neutralized', safeFileName('.hidden.mp3'), '_hidden.mp3');

// Degenerate input still yields something writable.
check('empty name', safeFileName(''), 'untitled');
check('null name', safeFileName(null), 'untitled');
check('undefined name', safeFileName(undefined), 'untitled');
check('whitespace only', safeFileName('   '), 'untitled');

// Long names: NTFS caps a path component at 255; 180 leaves room for the folder.
const long = 'a'.repeat(500) + '.mp3';
check('long name truncated', safeFileName(long).length, 180);
check('truncated name is still non-empty', safeFileName(long).startsWith('aaa'), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
