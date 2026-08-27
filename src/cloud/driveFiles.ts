// Pure helpers for the EXPERIMENTAL Google Drive layer (Phase 2).
//
// The Drive API hands back a flat list of files; everything the UI needs to do
// with that list — classify, search, filter, total up — lives here so it can be
// tested without Electron, OAuth or a network. See electron/googleDrive.cjs for
// the fetching side and src/cloud/cloudSources.ts for Phase 1 (synced folders).

export type DriveKind = 'audio' | 'video' | 'other';

/** One file as returned by files.list. `size` is a STRING in the Drive API
 *  (int64 doesn't survive JSON), and is absent for Google-native docs. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

/** Which stack a Drive file belongs to. Drive's mimeType is authoritative here;
 *  the extension is not (Drive happily stores 'song.mp3' as application/octet-
 *  stream when the uploader set no type). */
export function classifyDrive(mimeType: string | undefined | null): DriveKind {
  const m = String(mimeType ?? '').toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'other';
}

/** Byte size as a number. Missing/garbage sizes count as 0 rather than NaN,
 *  which would poison any total they were summed into. */
export function driveSize(file: DriveFile): number {
  const n = Number(file.size);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function totalBytes(files: DriveFile[]): number {
  return files.reduce((sum, f) => sum + driveSize(f), 0);
}

/**
 * Search + kind filter for the file list.
 *
 * 'all' means all MEDIA — anything classified 'other' is dropped even here. The
 * app has nowhere to put a PDF, so a non-media file must never reach the list
 * where it could be ticked and downloaded. (The Drive query already asks only
 * for audio/video, but a mime type we don't recognise would otherwise slip
 * through and render as if it were a song.)
 *
 * An empty query matches everything; matching is case-insensitive substring,
 * which is what a user scanning for "doja" expects.
 */
export function filterDriveFiles(
  files: DriveFile[],
  opts: { query?: string; kind?: DriveKind | 'all' }
): DriveFile[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const kind = opts.kind ?? 'all';
  return files.filter((f) => {
    const k = classifyDrive(f.mimeType);
    if (k === 'other') return false;
    if (kind !== 'all' && k !== kind) return false;
    if (!q) return true;
    return f.name.toLowerCase().includes(q);
  });
}

/** Split a list into the audio and video stacks, dropping anything else.
 *  Drive can return odd mime types, and only these two have a home in the app. */
export function partitionByKind(files: DriveFile[]): { audio: DriveFile[]; video: DriveFile[] } {
  const audio: DriveFile[] = [];
  const video: DriveFile[] = [];
  for (const f of files) {
    const kind = classifyDrive(f.mimeType);
    if (kind === 'audio') audio.push(f);
    else if (kind === 'video') video.push(f);
  }
  return { audio, video };
}

/** Stable sort for display: audio first, then by name (case-insensitive). */
export function sortForDisplay(files: DriveFile[]): DriveFile[] {
  return [...files].sort((a, b) => {
    const ka = classifyDrive(a.mimeType);
    const kb = classifyDrive(b.mimeType);
    if (ka !== kb) return ka === 'audio' ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}
