// Run: npx tsx src/services/lyricsSearch.test.ts
// Pure: no network, no IDB — just tracks in, hits out.
import {
  normalizeLyricText,
  trackLyricLines,
  countIndexedTracks,
  tracksMissingLyrics,
  searchLyrics,
} from './lyricsSearch';
import type { Track } from '../types';

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

const track = (over: Partial<Track>): Track =>
  ({ id: 'x', name: 'Song', artist: 'Artist', ...over } as Track);

// --- normalization -----------------------------------------------------------
eq(normalizeLyricText("Don't  STOP!"), 'dont stop', 'lowercases, strips punctuation, collapses space');
eq(normalizeLyricText('I’m free'), 'im free', 'curly apostrophe folds like a straight one');
eq(normalizeLyricText('Sigur Rós — Hoppípolla'), 'sigur rós hoppípolla', 'keeps letters outside ascii');
eq(normalizeLyricText(''), '', 'empty stays empty');

// --- line extraction ---------------------------------------------------------
const synced = track({
  id: 's',
  syncedLyrics: [
    { text: 'first line', timestamp: 1 },
    { text: 'second line', timestamp: 5 },
  ],
  lyrics: 'ignored plain text',
});
eq(trackLyricLines(synced).length, 2, 'synced lyrics win over plain');
eq(trackLyricLines(synced)[1].timestamp, 5, 'timestamps survive');
eq(trackLyricLines(track({ lyrics: 'a\nb\nc' })).length, 3, 'plain lyrics split on newline');
eq(trackLyricLines(track({ lyrics: 'a\nb' }))[0].timestamp, undefined, 'plain lines carry no timestamp');
eq(trackLyricLines(track({})).length, 0, 'a track with no lyrics has no lines');
// A blank line must stay, or lineIndex would stop matching the rendered view.
eq(trackLyricLines(track({ lyrics: 'a\n\nb' })).length, 3, 'blank lines are kept for index alignment');

// --- index size --------------------------------------------------------------
const lib: Track[] = [
  track({ id: '1', name: 'Alpha', lyrics: "I won't back down\nno I won't back down" }),
  track({ id: '2', name: 'Beta', syncedLyrics: [{ text: 'Hello darkness my old friend', timestamp: 12 }] }),
  track({ id: '3', name: 'Gamma' }),
  track({ id: '4', name: 'Delta', syncedLyrics: [] }),
];
eq(countIndexedTracks(lib), 2, 'counts only tracks with lyrics');
eq(tracksMissingLyrics(lib).map((t) => t.id), ['3', '4'], 'empty synced array counts as missing');

// --- search ------------------------------------------------------------------
eq(searchLyrics(lib, ''), [], 'empty query returns nothing');
eq(searchLyrics(lib, 'a'), [], 'one character is below the minimum');

const hits = searchLyrics(lib, 'back down');
eq(hits.length, 2, 'finds both matching lines');
eq(hits[0].trackId, '1', 'hit carries the track id');
ok(hits.every((h) => h.timestamp === undefined), 'plain-lyric hits have no timestamp to jump to');

const synHit = searchLyrics(lib, 'darkness')[0];
eq(synHit.timestamp, 12, 'a synced hit carries the timestamp to seek to');
eq(synHit.lineIndex, 0, 'hit carries the line index');
eq(synHit.matchStart, 6, 'match offset points at the phrase in the raw line');
eq(synHit.matchEnd, 14, 'match end covers the query length');

// Case and punctuation insensitivity.
ok(searchLyrics(lib, 'HELLO DARKNESS').length === 1, 'search is case-insensitive');
const apo = searchLyrics(lib, 'wont back');
ok(apo.length === 2, "punctuation-insensitive fallback matches \"won't\" for \"wont\"");
eq(apo[0].matchStart, -1, 'fallback match highlights the whole line (no valid offsets)');

// Context lines.
const ctx = searchLyrics(lib, 'no I')[0];
eq(ctx.before, "I won't back down", 'hit carries the previous line as context');
eq(ctx.after, undefined, 'last line has no following context');

// Ranking: a line STARTING with the phrase outranks one that merely contains it.
const rank = searchLyrics(
  [track({ id: 'r', lyrics: 'and the rain came down\nrain came down on me' })],
  'rain came'
);
eq(rank[0].lineIndex, 1, 'a line starting with the phrase ranks first');

// perTrack cap: a chorus repeated 10x must not flood the results.
const chorus = track({ id: 'c', lyrics: Array(10).fill('same line here').join('\n') });
eq(searchLyrics([chorus], 'same line').length, 4, 'per-track cap defaults to 4');
eq(searchLyrics([chorus], 'same line', { perTrack: 2 }).length, 2, 'per-track cap is configurable');
eq(searchLyrics([chorus], 'same line', { perTrack: 10, limit: 3 }).length, 3, 'total limit applies');

// Blank lines never match, even though they are indexed.
eq(searchLyrics([track({ id: 'b', lyrics: 'a\n   \nback down' })], 'back down').length, 1, 'blank lines are skipped');

if (fail.length) {
  console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
  for (const f of fail) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`  lyricsSearch: ${passed} assertions passed`);
