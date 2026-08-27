// Run with: npx tsx src/cloud/driveFiles.test.ts
import {
  classifyDrive,
  driveSize,
  totalBytes,
  filterDriveFiles,
  partitionByKind,
  sortForDisplay,
  type DriveFile,
} from './driveFiles';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const f = (name: string, mimeType: string, size?: string): DriveFile => ({
  id: name,
  name,
  mimeType,
  size,
});

// ─── classifyDrive ───────────────────────────────────────────────────────────
check('audio/mpeg → audio', classifyDrive('audio/mpeg'), 'audio');
check('audio/flac → audio', classifyDrive('audio/flac'), 'audio');
check('video/mp4 → video', classifyDrive('video/mp4'), 'video');
check('case-insensitive', classifyDrive('AUDIO/MPEG'), 'audio');
check('folder → other', classifyDrive('application/vnd.google-apps.folder'), 'other');
// Uploads with no declared type are common and must NOT be guessed into audio —
// downloading a 2 GB zip because it was named .mp3 would be the bug.
check('octet-stream → other', classifyDrive('application/octet-stream'), 'other');
check('missing mime → other', classifyDrive(undefined), 'other');
check('null mime → other', classifyDrive(null), 'other');

// ─── driveSize / totalBytes ──────────────────────────────────────────────────
// The API sends size as a STRING; a naive sum would concatenate instead of add.
check('string size parsed', driveSize(f('a', 'audio/mpeg', '1024')), 1024);
check('absent size → 0', driveSize(f('a', 'audio/mpeg')), 0);
check('garbage size → 0', driveSize(f('a', 'audio/mpeg', 'abc')), 0);
check('negative size → 0', driveSize(f('a', 'audio/mpeg', '-5')), 0);
check('sums as numbers not strings', totalBytes([
  f('a', 'audio/mpeg', '1000'),
  f('b', 'audio/mpeg', '2000'),
]), 3000);
check('a sizeless file cannot poison the total', totalBytes([
  f('a', 'audio/mpeg', '1000'),
  f('b', 'audio/mpeg'),
]), 1000);
check('empty total', totalBytes([]), 0);

// ─── filterDriveFiles ────────────────────────────────────────────────────────
const lib = [
  f('Bedroom Beats.m4a', 'audio/mp4', '1021000'),
  f('Antoine Waish - beats 78.m4a', 'audio/mp4', '1930000'),
  f('streets doja cat slowed.mp3', 'audio/mpeg', '4150000'),
  f('grok 2 video.mp4', 'video/mp4', '3000000'),
  f('notes.pdf', 'application/pdf', '5000'),
];

// 'all' means all MEDIA: the pdf is excluded even with no filters set, so a
// non-media file can never be ticked and downloaded. Regression — it used to
// render in the list with a music icon.
check('empty query matches all MEDIA, not the pdf', filterDriveFiles(lib, {}).length, 4);
check('pdf never appears under any filter', [
  ...filterDriveFiles(lib, {}),
  ...filterDriveFiles(lib, { kind: 'all' }),
  ...filterDriveFiles(lib, { query: 'notes' }),
  ...filterDriveFiles(lib, { query: 'pdf' }),
].some((x) => x.name === 'notes.pdf'), false);
check('query is case-insensitive', filterDriveFiles(lib, { query: 'DOJA' }).map((x) => x.name), [
  'streets doja cat slowed.mp3',
]);
check('query matches substring mid-name', filterDriveFiles(lib, { query: 'beats' }).length, 2);
check('whitespace-only query matches all media', filterDriveFiles(lib, { query: '   ' }).length, 4);
check('kind filter: audio', filterDriveFiles(lib, { kind: 'audio' }).length, 3);
check('kind filter: video', filterDriveFiles(lib, { kind: 'video' }).map((x) => x.name), [
  'grok 2 video.mp4',
]);
check('kind + query combine', filterDriveFiles(lib, { kind: 'audio', query: 'beats' }).length, 2);
check('no match → empty', filterDriveFiles(lib, { query: 'zzzz' }), []);

// ─── partitionByKind ─────────────────────────────────────────────────────────
const parts = partitionByKind(lib);
check('audio partition', parts.audio.length, 3);
check('video partition', parts.video.length, 1);
check('the pdf is dropped, not misfiled', parts.audio.concat(parts.video).some((x) => x.name === 'notes.pdf'), false);

// ─── sortForDisplay ──────────────────────────────────────────────────────────
// sortForDisplay only orders; filtering is filterDriveFiles' job, which is why
// the pdf still appears here but never reaches the UI.
check('audio before video, then alphabetical', sortForDisplay(lib).map((x) => x.name), [
  'Antoine Waish - beats 78.m4a',
  'Bedroom Beats.m4a',
  'streets doja cat slowed.mp3',
  'grok 2 video.mp4',
  'notes.pdf',
]);
check('sort does not mutate its input', lib[0].name, 'Bedroom Beats.m4a');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
