// Run with: npx tsx src/library/folderTree.test.ts
// Pure path math — no DOM, no React, no IndexedDB.
import type { Track } from '../types';
import { breadcrumb, continuationAfter, isUnder, parentOf, readDir, rootFolders, tracksUnder, tracksUnderOrdered, watchRoots } from './folderTree';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const track = (nativePath: string): Track => ({
  id: nativePath,
  name: nativePath.slice(nativePath.lastIndexOf('\\') + 1),
  artist: '',
  album: '',
  url: '',
  nativePath,
});

// D:\Music
//   ├ Rock\  (2 tracks, 1 in a sub-sub folder)
//   ├ Jazz\  (1)
//   └ loose.mp3
const lib = [
  track('D:\\Music\\Rock\\a.mp3'),
  track('D:\\Music\\Rock\\Live\\b.mp3'),
  track('D:\\Music\\Jazz\\c.mp3'),
  track('D:\\Music\\loose.mp3'),
];

// ─── roots ────────────────────────────────────────────────────────────────────
check(
  'single import root collapses past the drive letter',
  rootFolders(lib).map((f) => f.path),
  ['D:\\Music']
);
check('root reports every track beneath it', rootFolders(lib)[0].trackCount, 4);
check('root reports its direct subfolders', rootFolders(lib)[0].folderCount, 2);

// A chain with no branch point collapses all the way to the folder that has files.
check(
  'chain of single children collapses to the folder holding tracks',
  rootFolders([track('C:\\Users\\Me\\Music\\x.mp3')]).map((f) => f.path),
  ['C:\\Users\\Me\\Music']
);

check(
  'two separate imports stay two roots',
  rootFolders([track('C:\\A\\x.mp3'), track('D:\\B\\y.mp3')]).map((f) => f.path),
  ['C:\\A', 'D:\\B']
);

check(
  'a root is offline only when every track under it is missing',
  rootFolders(lib, (p) => p.includes('Rock')).map((f) => f.offline),
  [false]
);
check('all-missing root is offline', rootFolders(lib, () => true)[0].offline, true);

// ─── watch roots (never a bare drive letter) ───────────────────────────────────
// The desktop collapses two same-drive imports to a single `D:` icon...
check(
  'rootFolders collapses same-drive imports to the bare drive',
  rootFolders([track('D:\\MusicA\\x.mp3'), track('D:\\MusicB\\y.mp3')]).map((f) => f.path),
  ['D:']
);
// ...but `D:` cannot be watched, so watchRoots keeps each real folder instead.
check(
  'watchRoots expands the bare drive to each real folder',
  watchRoots([track('D:\\MusicA\\x.mp3'), track('D:\\MusicB\\y.mp3')]).sort(),
  ['D:\\MusicA', 'D:\\MusicB']
);
check(
  'watchRoots collapses a single import the same as rootFolders',
  watchRoots(lib),
  ['D:\\Music']
);
check(
  'watchRoots keeps cross-drive imports separate',
  watchRoots([track('C:\\A\\x.mp3'), track('D:\\B\\y.mp3')]).sort(),
  ['C:\\A', 'D:\\B']
);
check(
  'watchRoots watches the drive root for songs sitting directly on it',
  watchRoots([track('D:\\loose.mp3'), track('D:\\Album\\x.mp3')]).sort(),
  ['D:\\', 'D:\\Album']
);
check('watchRoots keeps posix roots', watchRoots([track('/home/me/music/a.mp3')]), ['/home/me/music']);
check('watchRoots keeps UNC roots', watchRoots([track('\\\\nas\\share\\a.mp3')]), ['\\\\nas\\share']);

// ─── one level ────────────────────────────────────────────────────────────────
const level = readDir(lib, 'D:\\Music');
check('subfolders are the immediate children only', level.folders.map((f) => f.name), ['Jazz', 'Rock']);
check('subfolder track counts are recursive', level.folders.map((f) => f.trackCount), [1, 2]);
check('subfolder folder counts are direct', level.folders.map((f) => f.folderCount), [0, 1]);
check('files are the tracks sitting directly in the dir', level.files.map((t) => t.name), ['loose.mp3']);

check('drilling in lists the sub-sub folder', readDir(lib, 'D:\\Music\\Rock').folders.map((f) => f.name), ['Live']);
check('drilling in lists that folder’s own files', readDir(lib, 'D:\\Music\\Rock').files.map((t) => t.name), ['a.mp3']);
check('leaf folder has no subfolders', readDir(lib, 'D:\\Music\\Rock\\Live').folders.length, 0);

// A sibling whose name prefixes another must not swallow it.
const prefixed = [track('D:\\M\\Rock\\a.mp3'), track('D:\\M\\RockLive\\b.mp3')];
check('prefix sibling is not treated as a child', readDir(prefixed, 'D:\\M').folders.map((f) => f.name), [
  'Rock',
  'RockLive',
]);

// ─── navigation ───────────────────────────────────────────────────────────────
check('isUnder is strict', isUnder('D:\\Music', 'D:\\Music'), false);
check('isUnder ignores case', isUnder('d:\\music\\rock', 'D:\\Music'), true);
check('parentOf walks up', parentOf('D:\\Music\\Rock\\Live', 'D:\\Music'), 'D:\\Music\\Rock');
check('parentOf stops at the window root', parentOf('D:\\Music', 'D:\\Music'), null);
check(
  'breadcrumb spans root to cwd',
  breadcrumb('D:\\Music\\Rock\\Live', 'D:\\Music').map((c) => c.name),
  ['Music', 'Rock', 'Live']
);

// ─── play-all ─────────────────────────────────────────────────────────────────
check('tracksUnder is recursive', tracksUnder(lib, 'D:\\Music\\Rock').map((t) => t.name), ['a.mp3', 'b.mp3']);
check('tracksUnder from the root takes everything', tracksUnder(lib, 'D:\\Music').length, 4);

// ─── explorer-order playback (wires / play-all) ───────────────────────────────
// A library whose IMPORT order is deliberately scrambled relative to the
// explorer's display. Wired playback must follow the display top-to-bottom:
// subfolders first (the icon grid sits ABOVE the track rows), then the folder's
// own files, name-sorted at every level, recursively.
const scrambled = [
  track('D:\\Music\\Rock\\Live\\z-encore.mp3'), // deep subfolder, imported first
  track('D:\\Music\\b-second.mp3'),
  track('D:\\Music\\Jazz\\swing.mp3'),
  track('D:\\Music\\a-first.mp3'),
  track('D:\\Music\\Rock\\anthem.mp3'),
];
check(
  'tracksUnderOrdered walks the folder top-to-bottom as the explorer shows it',
  tracksUnderOrdered(scrambled, 'D:\\Music').map((t) => t.name),
  ['swing.mp3', 'z-encore.mp3', 'anthem.mp3', 'a-first.mp3', 'b-second.mp3']
);
check(
  'tracksUnderOrdered starts at the visual top, not the first-imported track',
  tracksUnderOrdered(scrambled, 'D:\\Music')[0].name,
  'swing.mp3'
);
check(
  'tracksUnderOrdered ends at the visual bottom (where the onward wire fires)',
  tracksUnderOrdered(scrambled, 'D:\\Music').at(-1)!.name,
  'b-second.mp3'
);
check(
  'tracksUnderOrdered numbers files with numeric-aware names correctly',
  tracksUnderOrdered([track('D:\\M\\10.mp3'), track('D:\\M\\2.mp3'), track('D:\\M\\1.mp3')], 'D:\\M').map((t) => t.name),
  ['1.mp3', '2.mp3', '10.mp3']
);

// ─── link switches ────────────────────────────────────────────────────────────
// isLinked = the per-subfolder switch. OFF subfolders are skipped entirely
// (wire entry / play-all), at every depth.
const rockOff = (p: string) => !p.toLowerCase().endsWith('\\rock');
check(
  'an unlinked subfolder (and everything under it) is skipped',
  tracksUnderOrdered(scrambled, 'D:\\Music', rockOff).map((t) => t.name),
  ['swing.mp3', 'a-first.mp3', 'b-second.mp3']
);
check(
  'the switch applies at every depth (unlink only the sub-sub folder)',
  tracksUnderOrdered(scrambled, 'D:\\Music', (p) => !p.toLowerCase().endsWith('\\live')).map((t) => t.name),
  ['swing.mp3', 'anthem.mp3', 'a-first.mp3', 'b-second.mp3']
);

// ─── continuation: playback started inside a subfolder ────────────────────────
check(
  'LINKED start: continue with the other linked subfolders, then the parent files',
  continuationAfter(scrambled, 'D:\\Music\\Jazz', 'D:\\Music').map((t) => t.name),
  ['z-encore.mp3', 'anthem.mp3', 'a-first.mp3', 'b-second.mp3']
);
check(
  'UNLINKED start: no continuation — plays alone, the root wire takes over',
  continuationAfter(scrambled, 'D:\\Music\\Jazz', 'D:\\Music', (p) => !p.toLowerCase().endsWith('\\jazz')).length,
  0
);
check(
  'no continuation above the window root itself',
  continuationAfter(scrambled, 'D:\\Music', 'D:\\Music').length,
  0
);
check(
  'nested start climbs level by level (rest of Rock, then rest of Music)',
  continuationAfter(scrambled, 'D:\\Music\\Rock\\Live', 'D:\\Music').map((t) => t.name),
  ['anthem.mp3', 'swing.mp3', 'a-first.mp3', 'b-second.mp3']
);
check(
  'the climb skips unlinked siblings',
  continuationAfter(scrambled, 'D:\\Music\\Jazz', 'D:\\Music', rockOff).map((t) => t.name),
  ['a-first.mp3', 'b-second.mp3']
);

// ─── posix / UNC round-trip ───────────────────────────────────────────────────
check(
  'posix paths keep their leading slash',
  rootFolders([track('/home/me/music/a.mp3'), track('/home/me/music/live/b.mp3')]).map((f) => f.path),
  ['/home/me/music']
);
check(
  'UNC paths keep their double backslash',
  rootFolders([track('\\\\nas\\share\\a.mp3'), track('\\\\nas\\share\\sub\\b.mp3')]).map((f) => f.path),
  ['\\\\nas\\share']
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
