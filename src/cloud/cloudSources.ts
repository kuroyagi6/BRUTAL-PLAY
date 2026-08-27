// Pure model for the EXPERIMENTAL cloud-sources layer.
//
// Google Drive for Desktop and iCloud for Windows both mount as ORDINARY
// FILESYSTEM PATHS (`G:\My Drive`, `C:\Users\<you>\iCloudDrive`), so this layer
// deliberately does NOT speak either cloud's API — it just finds those roots and
// hands the paths to the existing folder importer. No OAuth, no tokens, no
// network code, nothing to break when an API changes.
//
// (A real Drive API integration is a possible later phase — it would see files
// that aren't synced to disk. It would add a new provider here, not change this.)
//
// Everything in this file is pure so it can be tested without Electron:
// the main process probes the filesystem and reports `RawCloudMount`s, and the
// renderer turns them into display-ready `CloudSource`s here.

export type CloudProvider = 'google-drive' | 'icloud';

/** A mount as reported by the main process (see electron/cloudMounts.cjs). */
export interface RawCloudMount {
  provider: CloudProvider;
  /** Absolute root to browse/import from, e.g. 'G:\\My Drive'. */
  path: string;
  /**
   * Windows volume label, when the mount is a drive letter. Google Drive names
   * the volume '<account> - Google Drive', but Windows caps volume labels at 32
   * chars so it usually arrives truncated ('a@gmail.com - Goo...'). Absent for
   * folder-based mounts (iCloud), and null when the probe failed.
   */
  label?: string | null;
}

/** A detected cloud root, ready to draw as a desktop icon. */
export interface CloudSource {
  /** Stable id derived from the path, so icon positions survive restarts. */
  id: string;
  provider: CloudProvider;
  path: string;
  /** Account email when one could be recovered from the volume label, else null. */
  account: string | null;
  /** Short uppercase label for the tile. */
  displayName: string;
}

/**
 * Recover the account email from a Google Drive volume label.
 *
 * The label is routinely truncated by Windows' 32-char cap, so this matches the
 * email PREFIX rather than parsing the whole '<email> - Google Drive' shape.
 * Returns null when no complete address survived the truncation.
 */
export function parseAccountEmail(label: string | null | undefined): string | null {
  if (!label) return null;
  // Require a plausible TLD so a truncated address ('someone@gmai...') is
  // rejected rather than shown to the user as if it were real.
  const m = label.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/** 'G:\\My Drive' → 'G'. Null for folder mounts. */
export function driveLetterOf(path: string): string | null {
  const m = path.match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : null;
}

/** Stable, filesystem-case-insensitive id for a mount path. */
export function cloudSourceId(path: string): string {
  return `cloud:${path.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

/** Tile caption. Prefers the account's local-part — that's what distinguishes
 *  two Drive accounts mounted side by side. */
export function displayNameFor(provider: CloudProvider, account: string | null, path: string): string {
  if (provider === 'icloud') return 'ICLOUD_DRIVE';
  if (account) return account.split('@')[0].toUpperCase();
  const letter = driveLetterOf(path);
  return letter ? `GOOGLE_DRIVE_${letter}` : 'GOOGLE_DRIVE';
}

/** Turn a main-process mount report into a display-ready source. */
export function describeMount(raw: RawCloudMount): CloudSource {
  const account = raw.provider === 'google-drive' ? parseAccountEmail(raw.label) : null;
  return {
    id: cloudSourceId(raw.path),
    provider: raw.provider,
    path: raw.path,
    account,
    displayName: displayNameFor(raw.provider, account, raw.path),
  };
}

/**
 * Full detection result → the tiles to draw. Drops duplicates by id (two probes
 * can report the same root) and sorts for a stable on-screen order: iCloud last,
 * Drive accounts alphabetical, so tiles don't reshuffle between launches.
 */
export function toCloudSources(raws: RawCloudMount[]): CloudSource[] {
  const seen = new Set<string>();
  const out: CloudSource[] = [];
  for (const raw of raws) {
    const src = describeMount(raw);
    if (seen.has(src.id)) continue;
    seen.add(src.id);
    out.push(src);
  }
  return out.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider === 'google-drive' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}
