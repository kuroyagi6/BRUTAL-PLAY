// Run with: npx tsx src/library/trackSort.test.ts
// Pure ordering — no DOM, no React.
import type { Track } from '../types';
import { sortTracks } from './trackSort';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const track = (name: string, artist: string, album: string, duration: number): Track => ({
  id: name,
  name,
  artist,
  album,
  url: '',
  duration,
});

const lib = [
  track('Bravo', 'Zed', 'Second', 200),
  track('alpha', 'Ann', 'First', 100),
  track('Charlie', 'Mia', 'Third', 50),
];

check('DEFAULT keeps input order', sortTracks(lib, 'DEFAULT').map((t) => t.id), ['Bravo', 'alpha', 'Charlie']);
check('DEFAULT returns the same array (no copy)', sortTracks(lib, 'DEFAULT') === lib, true);
check('A-Z is case-insensitive by name', sortTracks(lib, 'A-Z').map((t) => t.id), ['alpha', 'Bravo', 'Charlie']);
check('Z-A reverses name order', sortTracks(lib, 'Z-A').map((t) => t.id), ['Charlie', 'Bravo', 'alpha']);
check('ARTIST sorts by artist', sortTracks(lib, 'ARTIST').map((t) => t.artist), ['Ann', 'Mia', 'Zed']);
check('ALBUM sorts by album', sortTracks(lib, 'ALBUM').map((t) => t.album), ['First', 'Second', 'Third']);
check('DURATION is longest first', sortTracks(lib, 'DURATION').map((t) => t.duration), [200, 100, 50]);
check('sorting never mutates the input', (sortTracks(lib, 'A-Z'), lib.map((t) => t.id)), ['Bravo', 'alpha', 'Charlie']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
