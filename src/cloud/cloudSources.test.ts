// Run with: npx tsx src/cloud/cloudSources.test.ts
import {
  parseAccountEmail,
  driveLetterOf,
  cloudSourceId,
  displayNameFor,
  describeMount,
  toCloudSources,
} from './cloudSources';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── parseAccountEmail ───────────────────────────────────────────────────────
// The real labels on this machine — Windows truncated both at 32 chars, which is
// exactly why the parser matches the email prefix instead of the whole shape.
check(
  'truncated Drive label → email',
  parseAccountEmail('americanhoody2002@gmail.com -...'),
  'americanhoody2002@gmail.com'
);
check(
  'second truncated Drive label → email',
  parseAccountEmail('littleboy0241@gmail.com - Goo...'),
  'littleboy0241@gmail.com'
);
check(
  'untruncated label → email',
  parseAccountEmail('someone@example.org - Google Drive'),
  'someone@example.org'
);
check('lowercased', parseAccountEmail('Someone@Example.ORG - Google Drive'), 'someone@example.org');
// A long address gets cut mid-domain; showing 'x@gmai' as an account would be a lie.
check('email truncated before a TLD → null', parseAccountEmail('averyveryverylongname@gmai...'), null);
check('no email in label → null', parseAccountEmail('Media'), null);
check('empty label → null', parseAccountEmail(''), null);
check('null label → null', parseAccountEmail(null), null);
check('undefined label → null', parseAccountEmail(undefined), null);

// ─── driveLetterOf ───────────────────────────────────────────────────────────
check('drive path → letter', driveLetterOf('G:\\My Drive'), 'G');
check('lowercase drive path → uppercase letter', driveLetterOf('g:\\My Drive'), 'G');
check('folder mount still has a letter', driveLetterOf('C:\\Users\\ADMIN\\iCloudDrive'), 'C');
check('UNC path → null', driveLetterOf('\\\\server\\share'), null);

// ─── cloudSourceId ───────────────────────────────────────────────────────────
check('id is stable + case-insensitive', cloudSourceId('G:\\My Drive'), cloudSourceId('g:\\my drive'));
check('id shape', cloudSourceId('G:\\My Drive'), 'cloud:g_my_drive');
check('id trims separators', cloudSourceId('C:\\Users\\ADMIN\\iCloudDrive\\'), 'cloud:c_users_admin_iclouddrive');
check('two accounts get distinct ids', cloudSourceId('G:\\My Drive') === cloudSourceId('H:\\My Drive'), false);

// ─── displayNameFor ──────────────────────────────────────────────────────────
check('Drive with account → local part', displayNameFor('google-drive', 'americanhoody2002@gmail.com', 'G:\\My Drive'), 'AMERICANHOODY2002');
check('Drive without account → letter', displayNameFor('google-drive', null, 'G:\\My Drive'), 'GOOGLE_DRIVE_G');
check('iCloud ignores account', displayNameFor('icloud', null, 'C:\\Users\\ADMIN\\iCloudDrive'), 'ICLOUD_DRIVE');

// ─── describeMount ───────────────────────────────────────────────────────────
check('describes a Drive mount', describeMount({
  provider: 'google-drive',
  path: 'G:\\My Drive',
  label: 'americanhoody2002@gmail.com -...',
}), {
  id: 'cloud:g_my_drive',
  provider: 'google-drive',
  path: 'G:\\My Drive',
  account: 'americanhoody2002@gmail.com',
  displayName: 'AMERICANHOODY2002',
});
// iCloud has no volume label to read, and no API to ask — account is always null.
check('describes an iCloud mount', describeMount({
  provider: 'icloud',
  path: 'C:\\Users\\ADMIN\\iCloudDrive',
}), {
  id: 'cloud:c_users_admin_iclouddrive',
  provider: 'icloud',
  path: 'C:\\Users\\ADMIN\\iCloudDrive',
  account: null,
  displayName: 'ICLOUD_DRIVE',
});
// A label that looks like Drive's must not leak an account onto an iCloud tile.
check('iCloud never parses an account', describeMount({
  provider: 'icloud',
  path: 'C:\\Users\\ADMIN\\iCloudDrive',
  label: 'someone@example.org - Google Drive',
}).account, null);

// ─── toCloudSources ──────────────────────────────────────────────────────────
const detected = toCloudSources([
  { provider: 'icloud', path: 'C:\\Users\\ADMIN\\iCloudDrive' },
  { provider: 'google-drive', path: 'H:\\My Drive', label: 'littleboy0241@gmail.com - Goo...' },
  { provider: 'google-drive', path: 'G:\\My Drive', label: 'americanhoody2002@gmail.com -...' },
]);
check('sorted: Drive accounts alphabetical, iCloud last', detected.map((s) => s.displayName), [
  'AMERICANHOODY2002',
  'LITTLEBOY0241',
  'ICLOUD_DRIVE',
]);
check('both Drive accounts survive', detected.filter((s) => s.provider === 'google-drive').length, 2);
check('duplicate roots collapse', toCloudSources([
  { provider: 'google-drive', path: 'G:\\My Drive', label: 'a@b.com - Google Drive' },
  { provider: 'google-drive', path: 'g:\\my drive', label: 'a@b.com - Google Drive' },
]).length, 1);
check('no mounts → empty', toCloudSources([]), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
