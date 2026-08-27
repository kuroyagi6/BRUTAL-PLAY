// Google Drive API access for the EXPERIMENTAL Drive layer (Phase 2).
//
// Two operations only: LIST the media files in the user's Drive, and DOWNLOAD
// the ones they pick. Read-only — the OAuth scope grants nothing else.
//
// ─── Why download instead of stream ──────────────────────────────────────────
// A Drive file can only be fetched with an `Authorization: Bearer` header, and an
// <audio src> cannot send one. Rather than teach the audio engine to speak Drive
// (which would mean touching resolvePlayableSource, and with it playback, seeking
// and the EQ graph), downloaded files are written to a normal folder on disk and
// handed to the ORDINARY importer. From that moment they are indistinguishable
// from any other local track: metadata scanning, blob playback, EQ, visualizer,
// queue and offline use all work with zero engine changes.
//
// The cost is honest and worth stating: importing copies the bytes onto this PC.

const fs = require('fs');
const path = require('path');

// `electron` and googleAuth are required LAZILY, inside the functions that need
// them, so the pure helpers here (safeFileName) can be unit-tested under plain
// node — requiring electron at module load would make that impossible.
const electronApp = () => require('electron').app;
const authToken = () => require('./googleAuth.cjs').getAccessToken();

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

// Drive's max is 1000; 200 keeps each round-trip small enough to stay responsive
// while still walking a big library in few requests.
const PAGE_SIZE = 200;

const REQUEST_TIMEOUT_MS = 20000;

/** Where downloaded Drive files land. Visible on purpose — these are the user's
 *  files, not an opaque cache, and they stay playable if this app is removed. */
function downloadDir() {
  return path.join(electronApp().getPath('music'), 'BrutalPlayer', 'Google Drive');
}

async function driveFetch(url, { signal, headers } = {}) {
  const token = await authToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message ? ` — ${body.error.message}` : '';
    } catch {
      /* non-JSON error body */
    }
    // 403 covers two very different setup mistakes and the fix for one is
    // useless for the other, so key the hint off Google's own message rather
    // than guessing from the status code.
    if (res.status === 403) {
      // The token simply lacks drive.readonly. Requesting it in the auth URL is
      // NOT enough: it is a restricted scope, so it must also be declared under
      // Google Auth Platform -> Data Access, and an already-issued token keeps
      // the old scopes until the user signs out and consents again.
      if (/insufficient authentication scopes|insufficientPermissions/i.test(detail)) {
        throw new Error(
          `Drive refused the request${detail} — add the drive.readonly scope under Google Auth Platform > Data Access, then SIGN_OUT and sign in again to mint a new token`
        );
      }
      throw new Error(`Drive refused the request${detail} (is the Drive API enabled in your Google Cloud project?)`);
    }
    throw new Error(`Drive HTTP ${res.status}${detail}`);
  }
  return res;
}

/**
 * One page of the user's audio/video files, newest folders first.
 * Resolves { files: [{id, name, mimeType, size, modifiedTime}], nextPageToken }.
 */
async function listMediaFiles(pageToken) {
  const params = new URLSearchParams({
    // `contains` on mimeType matches the family, so this catches audio/mpeg,
    // audio/flac, video/mp4 and everything else without listing every subtype.
    q: "(mimeType contains 'audio/' or mimeType contains 'video/') and trashed = false",
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
    pageSize: String(PAGE_SIZE),
    orderBy: 'name',
    // Include files on shared drives the user can read, not just My Drive.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await driveFetch(`${FILES_ENDPOINT}?${params}`, { signal: controller.signal });
    const json = await res.json();
    return { files: json.files ?? [], nextPageToken: json.nextPageToken ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/** Walk every page. `onPage` lets the UI fill in as results arrive. */
async function listAllMediaFiles(onPage) {
  const all = [];
  let pageToken = null;
  do {
    const { files, nextPageToken } = await listMediaFiles(pageToken);
    all.push(...files);
    if (typeof onPage === 'function') onPage(files, all.length);
    pageToken = nextPageToken;
  } while (pageToken);
  return all;
}

/** Strip characters Windows forbids, so a Drive name can't break the write. */
function safeFileName(name) {
  const cleaned = String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  return cleaned.slice(0, 180) || 'untitled';
}

/**
 * Download one file to `downloadDir()`. Returns its local path.
 *
 * Skips the transfer when a file of the same name AND byte size is already
 * there, so re-importing is cheap and never duplicates. On any failure the
 * partial file is removed rather than left to look like a real track.
 */
async function downloadFile(file) {
  const dir = downloadDir();
  fs.mkdirSync(dir, { recursive: true });

  const dest = path.join(dir, safeFileName(file.name));
  const expected = file.size ? Number(file.size) : null;

  try {
    const stat = fs.statSync(dest);
    if (expected == null || stat.size === expected) return dest;
    // Size mismatch: a previous download was cut short — fall through and redo it.
  } catch {
    /* not downloaded yet */
  }

  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const res = await driveFetch(`${FILES_ENDPOINT}/${encodeURIComponent(file.id)}?${params}`);

  const tmp = `${dest}.part`;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    return dest;
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    throw e;
  }
}

/**
 * Download several files, reporting progress per file.
 * Resolves { paths, failed } — one bad file must not abandon the whole import.
 */
async function downloadFiles(files, onProgress) {
  const paths = [];
  const failed = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (typeof onProgress === 'function') {
      onProgress({ done: i, total: files.length, name: file.name });
    }
    try {
      paths.push(await downloadFile(file));
    } catch (e) {
      console.warn('Drive download failed:', file.name, e);
      failed.push({ name: file.name, error: String(e?.message ?? e) });
    }
  }

  if (typeof onProgress === 'function') {
    onProgress({ done: files.length, total: files.length, name: null });
  }
  return { paths, failed };
}

module.exports = { listMediaFiles, listAllMediaFiles, downloadFiles, downloadDir, safeFileName };
