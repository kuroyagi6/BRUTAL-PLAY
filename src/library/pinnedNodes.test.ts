// Run: npx tsx src/library/pinnedNodes.test.ts
import {
  pinId,
  samePin,
  hasPin,
  addPin,
  removePin,
  albumTracks,
  artistNodeTracks,
  pinTracks,
  pinTrackIds,
  pinCover,
  prunePins,
  type PinnedNode,
} from './pinnedNodes';
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

const tk = (id: string, artist: string, album: string, coverUrl?: string): Track =>
  ({ id, name: id, artist, album, url: '', coverUrl } as Track);

const album = (key: string): PinnedNode => ({ kind: 'album', key });
const artist = (key: string): PinnedNode => ({ kind: 'artist', key });

// --- identity ----------------------------------------------------------------
eq(pinId(album('Illmatic')), 'album:Illmatic', 'pin id matches the kind:key convention');
eq(pinId(artist('Nas')), 'artist:Nas', 'artist pin id');
ok(samePin(album('A'), album('A')), 'same pin');
ok(!samePin(album('A'), artist('A')), 'same key, different kind is a different node');

// --- the pin list ------------------------------------------------------------
eq(addPin([], album('Illmatic')), [album('Illmatic')], 'add to empty');
eq(addPin([album('Illmatic')], album('Illmatic')), [album('Illmatic')], 'adding twice is a no-op');
eq(
  addPin([album('Illmatic')], artist('Illmatic')),
  [album('Illmatic'), artist('Illmatic')],
  'same key of another kind is a separate pin'
);
eq(addPin([], album('   ')), [], 'blank key is never pinned');
{
  const pins = [album('A')];
  addPin(pins, album('B'));
  eq(pins, [album('A')], 'addPin never mutates the input');
}
eq(removePin([album('A'), artist('B')], album('A')), [artist('B')], 'remove by identity');
eq(removePin([album('A')], album('Z')), [album('A')], 'removing an absent pin is a no-op');
ok(hasPin([album('A')], album('A')), 'hasPin true');
ok(!hasPin([album('A')], artist('A')), 'hasPin is kind-aware');

// --- album resolution --------------------------------------------------------
{
  const lib = [
    tk('a', 'Nas', 'Illmatic'),
    tk('b', 'Nas', 'Illmatic'),
    tk('c', 'Nas', 'Stillmatic'),
  ];
  eq(pinTrackIds(lib, album('Illmatic')), ['a', 'b'], 'album node plays its tracks');
  eq(albumTracks(lib, 'Nope'), [], 'unknown album plays nothing');
  eq(albumTracks(lib, '  '), [], 'blank album plays nothing');
  eq(pinTrackIds(lib, album('Illmatic')), ['a', 'b'], 'album order follows library order');
}

// --- artist resolution: the whole point --------------------------------------
{
  const lib = [
    tk('own1', 'Nas', 'Illmatic'),
    tk('feat', 'Nas feat. Damian Marley', 'Distant Relatives'),
    tk('guest', 'Damian Marley feat. Nas', 'Welcome to Jamrock'),
    tk('other', 'Jay-Z', 'Reasonable Doubt'),
  ];
  eq(
    pinTrackIds(lib, artist('Nas')),
    ['own1', 'feat', 'guest'],
    'artist node plays every track crediting them, own first'
  );
  ok(
    !pinTrackIds(lib, artist('Nas')).includes('other'),
    'an unrelated artist never leaks into the node'
  );
  eq(pinTrackIds(lib, artist('Jay-Z')), ['other'], 'artist with no features');
  eq(artistNodeTracks(lib, 'Nobody'), [], 'unknown artist plays nothing');
}

// A guarded band name must not shred into fake members (see artistCredits).
{
  const lib = [tk('sep', 'Earth, Wind & Fire', 'I Am')];
  eq(pinTrackIds(lib, artist('Wind')), [], '"Wind" is not an artist in the library');
  eq(pinTrackIds(lib, artist('Earth, Wind & Fire')), ['sep'], 'the band resolves to its own track');
}

// --- cover -------------------------------------------------------------------
{
  const lib = [tk('a', 'Nas', 'Illmatic'), tk('b', 'Nas', 'Illmatic', 'blob:art')];
  eq(pinCover(lib, album('Illmatic')), 'blob:art', 'falls forward to the first available cover');
  eq(pinCover([tk('a', 'Nas', 'Illmatic')], album('Illmatic')), undefined, 'no cover available');
}

// --- pruning -----------------------------------------------------------------
{
  const lib = [tk('a', 'Nas', 'Illmatic')];
  eq(
    prunePins([album('Illmatic'), album('Deleted'), artist('Nas'), artist('Gone')], lib),
    [album('Illmatic'), artist('Nas')],
    'pins whose tracks vanished are dropped'
  );
  eq(prunePins([album('Illmatic')], []), [], 'empty library prunes everything');
  eq(prunePins([], lib), [], 'no pins');
}

// pinTracks dispatches on kind.
{
  const lib = [tk('a', 'Nas', 'Illmatic')];
  eq(pinTracks(lib, album('Illmatic')).length, 1, 'pinTracks handles albums');
  eq(pinTracks(lib, artist('Nas')).length, 1, 'pinTracks handles artists');
}

if (fail.length) {
  console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
  for (const f of fail) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`  pinnedNodes: ${passed} assertions passed`);
