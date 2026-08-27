// Run: npx tsx src/library/artistPage.test.ts
import { splitArtistTracks, artistStats, artistAlbums, formatRuntime } from './artistPage';
import type { Track } from '../types';

let passed = 0;
const fail: string[] = [];

function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else fail.push(`${what}\n    expected: ${e}\n    actual:   ${a}`);
}

let n = 0;
const tk = (artist: string, name = `t${++n}`, album = 'A', duration?: number): Track =>
  ({ id: name, name, artist, album, url: '', duration } as Track);

const names = (ts: Track[]) => ts.map((t) => t.name);

// --- the gap this page exists to close ---------------------------------------
{
  const lib = [
    tk('Nas', 'illmatic-track'),
    tk('Nas feat. Damian Marley', 'as-we-enter'),
    tk('Damian Marley feat. Nas', 'patience'),
    tk('Jay-Z', 'other-song'),
  ];
  const { own, appearsOn } = splitArtistTracks(lib, 'Nas');
  eq(names(own), ['illmatic-track'], 'own = exact tag match only');
  eq(
    names(appearsOn),
    ['as-we-enter', 'patience'],
    'appearsOn catches both a combined primary tag and a guest credit'
  );
}

// An unrelated artist's tracks never leak in.
{
  const { own, appearsOn } = splitArtistTracks([tk('Jay-Z', 'x'), tk('Nas', 'y')], 'Nas');
  eq(names(own), ['y'], 'unrelated artist excluded from own');
  eq(names(appearsOn), [], 'unrelated artist excluded from appearsOn');
}

// Normalization: a differently-punctuated credit still counts as an appearance.
{
  const { appearsOn } = splitArtistTracks([tk('Beyonce feat. JAY-Z', 'crazy')], 'Jay-Z');
  eq(names(appearsOn), ['crazy'], 'credit matching is punctuation/case-insensitive');
}

// A guarded band name must not be shredded into fake members.
{
  const lib = [tk('Earth, Wind & Fire', 'september'), tk('Wind', 'unrelated')];
  eq(names(splitArtistTracks(lib, 'Wind').own), ['unrelated'], 'band name does not credit "Wind"');
  eq(names(splitArtistTracks(lib, 'Wind').appearsOn), [], '"Wind" does not appear on September');
  eq(
    names(splitArtistTracks(lib, 'Earth, Wind & Fire').own),
    ['september'],
    'the band still finds its own track'
  );
}

// A track is never in both lists.
{
  const { own, appearsOn } = splitArtistTracks([tk('Nas', 'z')], 'Nas');
  eq([own.length, appearsOn.length], [1, 0], 'exact match is own, not also appearsOn');
}

eq(splitArtistTracks([], 'Nas'), { own: [], appearsOn: [] }, 'empty library');
eq(splitArtistTracks([tk('Nas', 'a')], ''), { own: [], appearsOn: [] }, 'blank artist matches nothing');

// --- stats -------------------------------------------------------------------
eq(artistStats([]), { trackCount: 0, albumCount: 0, totalDuration: 0 }, 'empty stats');
eq(
  artistStats([tk('Nas', 'a', 'Illmatic', 100), tk('Nas', 'b', 'Illmatic', 50), tk('Nas', 'c', 'Stillmatic', 30)]),
  { trackCount: 3, albumCount: 2, totalDuration: 180 },
  'counts tracks, distinct albums, total runtime'
);
eq(
  artistStats([tk('Nas', 'a', 'Illmatic'), tk('Nas', 'b', 'Illmatic', 60)]),
  { trackCount: 2, albumCount: 1, totalDuration: 60 },
  'missing durations count as zero, not NaN'
);
eq(artistStats([tk('Nas', 'a', '  ')]).albumCount, 0, 'blank album is not an album');

// --- albums ------------------------------------------------------------------
eq(artistAlbums([]), [], 'no albums');
{
  const lib = [
    tk('Nas', 'a', 'Stillmatic'),
    tk('Nas', 'b', 'Illmatic'),
    tk('Nas', 'c', 'Illmatic'),
    tk('Nas', 'd', ''),
  ];
  eq(artistAlbums(lib).map((a) => a.album), ['Illmatic', 'Stillmatic'], 'most tracks first');
  eq(artistAlbums(lib).map((a) => a.count), [2, 1], 'per-album counts');
  eq(artistAlbums(lib).length, 2, 'blank album name is skipped');
}
{
  // Cover comes from the first track that has one, not necessarily the first track.
  const withCover = { ...tk('Nas', 'b', 'Illmatic'), coverUrl: 'blob:cover' } as Track;
  const lib = [tk('Nas', 'a', 'Illmatic'), withCover];
  eq(artistAlbums(lib)[0].coverUrl, 'blob:cover', 'falls forward to the first available cover');
}
{
  const lib = [tk('Nas', 'a', 'Bbb'), tk('Nas', 'b', 'Aaa')];
  eq(artistAlbums(lib).map((a) => a.album), ['Aaa', 'Bbb'], 'equal counts break alphabetically');
}

// --- runtime formatting ------------------------------------------------------
eq(formatRuntime(0), '0M', 'zero runtime');
eq(formatRuntime(59), '0M', 'under a minute rounds down');
eq(formatRuntime(60), '1M', 'one minute');
eq(formatRuntime(2880), '48M', 'under an hour stays in minutes');
eq(formatRuntime(3600), '1H 0M', 'exactly one hour');
eq(formatRuntime(11520), '3H 12M', 'hours and minutes');
eq(formatRuntime(-5), '0M', 'negative clamps to zero');
eq(formatRuntime(NaN), '0M', 'NaN does not leak into the UI');

if (fail.length) {
  console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
  for (const f of fail) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`  artistPage: ${passed} assertions passed`);
