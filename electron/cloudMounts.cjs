// EXPERIMENTAL cloud-sources layer: find where Google Drive and iCloud have
// already mounted themselves on this machine.
//
// Both desktop clients expose the user's cloud as a NORMAL FILESYSTEM PATH:
//   Google Drive for Desktop → a virtual drive letter, e.g. 'G:\My Drive'
//   iCloud for Windows       → '%USERPROFILE%\iCloudDrive'
// So there is no API call, no OAuth and no token anywhere in this file — we look
// for directories. That is the whole reason this layer is cheap and hard to break.
//
// Two Google accounts signed into Drive get two drive letters. Telling them apart
// is the only fiddly part: the account name lives in the Windows VOLUME LABEL
// ('<email> - Google Drive'), which Windows caps at 32 characters, so it usually
// arrives truncated. We report the raw label and let the renderer recover what it
// can (see src/cloud/cloudSources.ts — that parsing is pure and tested).
//
// Returns [{ provider, path, label? }]. Never throws: an undetectable cloud is an
// empty list, not an error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Folder Google Drive creates inside each mounted account.
const GDRIVE_ROOT_DIR = 'My Drive';

// PowerShell can hang on a wedged network drive; past this we fall back.
const PROBE_TIMEOUT_MS = 5000;

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    // Missing, unreadable, or a disconnected drive letter — all "not here".
    return false;
  }
}

/**
 * Enumerate local drive letters with their volume labels, via one PowerShell
 * call. Resolves [{ letter, label }]; resolves [] (never rejects) if PowerShell
 * is unavailable or too slow, so callers can fall back to blind probing.
 */
function listVolumes() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // DriveType 3 = local disk, which is how Drive's virtual volume presents.
        "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ForEach-Object { \"$($_.DeviceID)|$($_.VolumeName)\" }",
      ],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const vols = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = line.match(/^([A-Za-z]):\|(.*)$/);
          if (m) vols.push({ letter: m[1].toUpperCase(), label: m[2].trim() || null });
        }
        resolve(vols);
      }
    );
  });
}

/** Every drive letter, for the fallback path where PowerShell gave us nothing. */
function allDriveLetters() {
  const letters = [];
  // Skip A/B (historically floppies — probing them can spin up phantom devices).
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    letters.push(String.fromCharCode(c));
  }
  return letters;
}

/** Google Drive for Desktop mounts, with their volume labels when we have them. */
async function findGoogleDrive() {
  const found = [];

  if (process.platform === 'win32') {
    const vols = await listVolumes();
    // Preferred path: we know which letters exist AND their labels.
    // Fallback: probe every letter, but then we have no account label at all.
    const candidates = vols.length
      ? vols
      : allDriveLetters().map((letter) => ({ letter, label: null }));

    for (const { letter, label } of candidates) {
      const root = path.join(`${letter}:\\`, GDRIVE_ROOT_DIR);
      if (isDir(root)) found.push({ provider: 'google-drive', path: root, label });
    }
  } else if (process.platform === 'darwin') {
    // macOS mounts under /Volumes; older clients used a home folder.
    const volumes = '/Volumes';
    try {
      for (const name of fs.readdirSync(volumes)) {
        if (!/google\s*drive/i.test(name)) continue;
        const withRoot = path.join(volumes, name, GDRIVE_ROOT_DIR);
        const root = isDir(withRoot) ? withRoot : path.join(volumes, name);
        if (isDir(root)) found.push({ provider: 'google-drive', path: root, label: name });
      }
    } catch {
      /* no /Volumes — nothing to find */
    }
  }

  // Legacy "Backup and Sync" put a real folder in the home directory.
  const legacy = path.join(os.homedir(), 'Google Drive');
  if (isDir(legacy) && !found.some((f) => f.path === legacy)) {
    found.push({ provider: 'google-drive', path: legacy, label: null });
  }

  return found;
}

/**
 * iCloud Drive's synced folder. NOTE: this folder is the ONLY supported way to
 * reach a user's iCloud files — Apple publishes no iCloud Drive API (CloudKit
 * only reaches an app's own container), so there is deliberately no "log in to
 * iCloud" path here or anywhere else in the app.
 */
function findICloud() {
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')]
      : [path.join(home, 'iCloudDrive'), path.join(home, 'iCloud Drive')];

  const found = [];
  for (const p of candidates) {
    if (isDir(p)) found.push({ provider: 'icloud', path: p });
  }
  return found;
}

/** All detected cloud roots. Resolves [] rather than throwing. */
async function detectCloudMounts() {
  try {
    const google = await findGoogleDrive();
    return [...google, ...findICloud()];
  } catch (e) {
    console.warn('Cloud mount detection failed:', e);
    return [];
  }
}

module.exports = { detectCloudMounts };
