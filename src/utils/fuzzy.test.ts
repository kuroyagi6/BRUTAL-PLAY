// Run with: npx tsx src/utils/fuzzy.test.ts
import { fuzzyMatch, matchFields, matchFieldsPrepared, prepareQuery } from './fuzzy';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// --- matching behaviour ---------------------------------------------------
check('exact substring hits', fuzzyMatch('rhap', 'Bohemian Rhapsody')?.indices, [9, 10, 11, 12]);
check('case-insensitive', fuzzyMatch('BOHEMIAN', 'bohemian rhapsody')?.indices, [0, 1, 2, 3, 4, 5, 6, 7]);
check('subsequence fallback', fuzzyMatch('bhr', 'Bohemian Rhapsody') !== null, true);
check('missing char → null', fuzzyMatch('zzz', 'Bohemian Rhapsody'), null);
check('all terms must hit', fuzzyMatch('bohemian queen', 'Bohemian Rhapsody'), null);
check('multi-term both hit', fuzzyMatch('boh rhap', 'Bohemian Rhapsody') !== null, true);
check('empty query → null', fuzzyMatch('   ', 'anything'), null);
check('empty text → null', fuzzyMatch('a', ''), null);

// Prefix beats mid-string, so typing the start of a title ranks it first.
const atStart = fuzzyMatch('boh', 'Bohemian Rhapsody')!.score;
const inMiddle = fuzzyMatch('boh', 'The Bohemian Sound')!.score;
check('prefix outscores mid-string', atStart > inMiddle, true);

// --- the perf refactor must not change results ----------------------------
// matchFieldsPrepared with a precomputed `lower` has to agree exactly with the
// old one-shot matchFields path. This is the whole safety net for hoisting the
// query parse and the toLowerCase out of the per-track loop.
const fields = [
  { key: 'name' as const, value: 'Bohemian Rhapsody', weight: 1 },
  { key: 'artist' as const, value: 'Queen', weight: 0.85 },
  { key: 'album' as const, value: 'A Night at the Opera', weight: 0.8 },
];
for (const q of ['rhap', 'queen', 'opera', 'bhr', 'q', 'night opera', 'zzz', 'QUEEN']) {
  const oneShot = matchFields(q, fields);
  const prepared = matchFieldsPrepared(
    prepareQuery(q)!,
    fields.map((f) => ({ ...f, lower: f.value.toLowerCase() }))
  );
  check(`prepared === one-shot for "${q}"`, prepared, oneShot);
}

// Weighting: an exact artist hit must beat the same letters buried in a title.
const best = matchFields('queen', fields);
check('best field is why it matched', best?.key, 'artist');

// An empty field value is skipped rather than scored.
check(
  'empty field value skipped',
  matchFieldsPrepared(prepareQuery('a')!, [{ key: 'genre' as const, value: '', weight: 1 }]),
  null
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
