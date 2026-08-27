const fs = require('fs');
const path = require('path');

// Filesystem folder-watching for auto-import. Lives entirely in the main process
// (the renderer can't watch disk) and is fully self-contained: main.cjs wires it
// to an IPC channel, nothing else knows it exists. It reuses the SAME audio-file
// scan the import dialog uses, so "what counts as a song / how a folder is walked"
// has exactly one definition (`collectAudioFiles`).

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma']);
// Container formats the <video> element can stream over local-media:// (which
// already advertises their MIME types and serves Range requests). Kept a
// separate set from AUDIO_EXTS: a folder is scanned for one kind or the other,
// so audio import never picks up a movie and vice-versa.
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv']);

/**
 * Recursively walk `dirs` and return every file whose extension is in `exts`,
 * deduped (case-insensitively, since Windows paths are case-insensitive).
 * Inaccessible files/folders are skipped rather than throwing.
 */
function collectFiles(dirs, exts) {
  const files = [];
  const seen = new Set();

  const scanDir = (dirPath) => {
    let entries;
    try {
      // withFileTypes gives the entry kind from the directory read itself, so we
      // don't pay a statSync syscall per file.
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      return; // skip inaccessible dirs
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
          const k = fullPath.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            files.push(fullPath);
          }
        }
      } catch (e) { /* skip inaccessible entries */ }
    }
  };

  for (const dir of dirs) scanDir(dir);
  return files;
}

/**
 * The one scanner shared by the audio import dialog and the folder watcher —
 * "what counts as a song / how a folder is walked" has exactly one definition.
 */
function collectAudioFiles(dirs) {
  return collectFiles(dirs, AUDIO_EXTS);
}

/** The video counterpart, used by the video import dialog. */
function collectVideoFiles(dirs) {
  return collectFiles(dirs, VIDEO_EXTS);
}

// How long a root must be quiet before we re-scan it. Copying an album fires a
// burst of rename events; debouncing coalesces them into one scan.
const DEBOUNCE_MS = 1500;

const key = (p) => p.replace(/[\\/]+$/, '').toLowerCase();

/**
 * Watch a changing set of root folders and, whenever one changes, hand its full
 * current audio-file list to `onFiles(rootPath, paths)`. The consumer de-dupes
 * against the library, so re-sending already-known paths is harmless.
 *
 * `setFolders` is idempotent: it opens watchers for newly-added roots and closes
 * them for roots no longer present, so it can be called on every library change.
 */
function createFolderWatcher(onFiles) {
  // key(root) -> { root, watcher, timer }
  const watched = new Map();

  const scheduleScan = (entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      // The root itself may have gone away (drive unplugged); scan is best-effort.
      try {
        onFiles(entry.root, collectAudioFiles([entry.root]));
      } catch (e) {
        console.warn('Folder rescan failed for', entry.root, e);
      }
    }, DEBOUNCE_MS);
  };

  const open = (root) => {
    let watcher;
    try {
      // Recursive watch is supported on Windows and macOS — the target platforms.
      watcher = fs.watch(root, { recursive: true });
    } catch (e) {
      console.warn('Could not watch folder', root, e);
      return null;
    }
    const entry = { root, watcher, timer: null };
    watcher.on('change', () => scheduleScan(entry));
    // fs.watch surfaces things like a deleted root through 'error'; drop the
    // watcher rather than letting it throw. A later setFolders re-opens it.
    watcher.on('error', () => close(root));
    return entry;
  };

  const close = (root) => {
    const entry = watched.get(key(root));
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try { entry.watcher.close(); } catch (e) { /* already closed */ }
    watched.delete(key(root));
  };

  const setFolders = (roots) => {
    const wanted = new Map();
    for (const r of roots || []) {
      if (typeof r === 'string' && r) wanted.set(key(r), r);
    }
    // Drop watchers we no longer want.
    for (const k of [...watched.keys()]) {
      if (!wanted.has(k)) close(watched.get(k).root);
    }
    // Add watchers for new roots.
    for (const [k, root] of wanted) {
      if (watched.has(k)) continue;
      const entry = open(root);
      if (entry) watched.set(k, entry);
    }
  };

  const closeAll = () => {
    for (const k of [...watched.keys()]) close(watched.get(k).root);
  };

  return { setFolders, closeAll };
}

module.exports = { collectAudioFiles, collectVideoFiles, createFolderWatcher };
