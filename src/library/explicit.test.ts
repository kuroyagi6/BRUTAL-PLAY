// Run with: npx tsx src/library/explicit.test.ts
// Pure rating logic — no DOM, no React.
import type { Track } from '../types';
import { isExplicit, filterByRating, explicitFromText, explicitFromNativeTags } from './explicit';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const track = (id: string, explicit?: boolean): Track => ({
  id, name: id, artist: 'A', album: 'B', url: '', explicit,
});

const e = track('e', true);
const c = track('c', false);
const u = track('u'); // unmarked
const lib = [e, c, u];

// isExplicit: only an explicit `true` counts.
check('explicit true is explicit', isExplicit(e), true);
check('explicit false is not', isExplicit(c), false);
check('unmarked is not explicit', isExplicit(u), false);

// filterByRating partitions the whole library (unmarked lands with clean).
check('ALL returns same array', filterByRating(lib, 'ALL') === lib, true);
check('EXPLICIT keeps only flagged', filterByRating(lib, 'EXPLICIT').map((t) => t.id), ['e']);
check('CLEAN keeps clean + unmarked', filterByRating(lib, 'CLEAN').map((t) => t.id), ['c', 'u']);
check('buckets partition the library',
  filterByRating(lib, 'EXPLICIT').length + filterByRating(lib, 'CLEAN').length, lib.length);

// explicitFromText: title/album convention.
check('bracketed explicit', explicitFromText('Song [Explicit]'), true);
check('parenthesised clean', explicitFromText('Song (Clean)'), false);
check('bare explicit word', explicitFromText('Explicit Content'), true);
check('nothing to say', explicitFromText('Ordinary Title', 'Ordinary Album'), undefined);
check('explicit wins ties', explicitFromText('Clean', 'Explicit'), true);

// explicitFromNativeTags: iTunes advisory across MP4 / ID3 shapes.
check('rtng atom explicit', explicitFromNativeTags({ iTunes: [{ id: 'rtng', value: 1 }] }), true);
check('rtng atom clean', explicitFromNativeTags({ iTunes: [{ id: 'rtng', value: 2 }] }), false);
check('rtng 4 explicit', explicitFromNativeTags({ iTunes: [{ id: 'rtng', value: 4 }] }), true);
check('ID3 TXXX advisory explicit',
  explicitFromNativeTags({ 'ID3v2.3': [{ id: 'TXXX:ITUNESADVISORY', value: { text: '1' } }] }), true);
check('rtng 0 stays unmarked', explicitFromNativeTags({ iTunes: [{ id: 'rtng', value: 0 }] }), undefined);
check('no advisory tag', explicitFromNativeTags({ iTunes: [{ id: 'titl', value: 'X' }] }), undefined);
check('no native block', explicitFromNativeTags(undefined), undefined);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
