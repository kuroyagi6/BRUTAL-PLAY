// Pure directory-hierarchy logic over the library's native file paths. No React,
// no DOM, no services — everything here is a function of `Track[]` plus a path,
// so the explorer windows can be rebuilt/restyled without touching this file.
//
// The library only stores each track's full `nativePath`; there is no folder
// record anywhere. Every folder in the UI is *derived* here.

import type { Track } from '../types';

// The tree only ever reads `nativePath` (for the hierarchy) and `name` (to sort
// files). Anything with those two fields can be organised — `Track` and
// `VideoItem` both qualify — so the functions are generic over this shape and
// the video explorer reuses the exact same (tested) path math as the audio one.
export interface PathItem {
  nativePath?: string;
  name: string;
}

export interface FolderEntry {
  /** Full native path of the folder. */
  path: string;
  /** Last path segment — what the icon is labelled with. */
  name: string;
  /** Tracks anywhere beneath this folder (recursive). */
  trackCount: number;
  /** Immediate subfolders that contain tracks. */
  folderCount: number;
  /** True only when every track beneath it is currently unreachable. */
  offline: boolean;
}

export interface DirListing<T extends PathItem = Track> {
  path: string;
  /** Immediate subfolders, name-sorted. */
  folders: FolderEntry[];
  /** Items sitting directly in this folder, name-sorted. */
  files: T[];
}

/** Tells the tree which native paths are currently unreachable (drive removed). */
export type IsMissing = (nativePath: string) => boolean;

const SEGMENTS = /[\\/]+/;

/** Windows paths compare case-insensitively; a lowercased copy is the key. */
const key = (p: string) => p.toLowerCase();

/**
 * Split a native path into its root prefix, its segments, and the separator
 * style it was written with. `\\server\share` (UNC) and `/home/x` (posix) both
 * carry a prefix that must survive a round-trip through `join`.
 */
function parse(p: string): { prefix: string; segs: string[]; sep: string } {
  const unc = p.startsWith('\\\\');
  const sep = p.includes('\\') ? '\\' : '/';
  const prefix = unc ? '\\\\' : p.startsWith('/') ? '/' : '';
  return { prefix, segs: p.split(SEGMENTS).filter(Boolean), sep };
}

const join = (prefix: string, segs: string[], sep: string) => prefix + segs.join(sep);

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');

/** Parent directory of a file path (or of a folder path). */
export function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

/** Last segment of a path — the display name. */
export function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  const name = i >= 0 ? p.slice(i + 1) : p;
  return name || p;
}

/** Same folder, ignoring case and a trailing separator. */
export function samePath(a: string, b: string): boolean {
  const strip = (p: string) => key(p).replace(/[\\/]+$/, '');
  return strip(a) === strip(b);
}

/** True when `child` is strictly beneath `ancestor`. */
export function isUnder(child: string, ancestor: string): boolean {
  const a = key(ancestor).replace(/[\\/]+$/, '');
  const c = key(child);
  return c.length > a.length + 1 && c.startsWith(a) && (c[a.length] === '\\' || c[a.length] === '/');
}

/**
 * The parent of `dir`, or null when `dir` is `root` (or somehow outside it).
 * Explorer windows never navigate above the root they were opened at.
 */
export function parentOf(dir: string, root: string): string | null {
  if (!isUnder(dir, root)) return null;
  const parent = dirOf(dir);
  return isUnder(parent, root) || samePath(parent, root) ? parent : null;
}

/** Path segments from `root` down to `dir`, as [label, path] pairs — a breadcrumb. */
export function breadcrumb(dir: string, root: string): { name: string; path: string }[] {
  const crumbs = [{ name: baseName(root), path: root }];
  if (!isUnder(dir, root)) return crumbs;
  const sep = sepOf(dir);
  const rest = dir.slice(root.length + 1).split(SEGMENTS).filter(Boolean);
  let acc = root;
  for (const seg of rest) {
    acc = acc + sep + seg;
    crumbs.push({ name: seg, path: acc });
  }
  return crumbs;
}

/** Every item anywhere beneath `dir`, in library order. */
export function tracksUnder<T extends PathItem>(tracks: T[], dir: string): T[] {
  return tracks.filter((t) => t.nativePath && (samePath(dirOf(t.nativePath), dir) || isUnder(t.nativePath, dir)));
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * The per-subfolder link switch: true = the subfolder participates in its
 * parent's playback flow (the default), false = it is skipped and plays only
 * when started inside. Asked for every subfolder at every depth.
 */
export type IsLinked = (path: string) => boolean;

/**
 * Every item beneath `dir` in EXPLORER order: the linked subfolders first
 * (name-sorted, recursive — the icon grid the window paints ABOVE the track
 * rows), then the files sitting directly in `dir`. This is the top-to-bottom
 * order a user sees in an explorer window with the DEFAULT sort — so it is the
 * queue order for play-all and for a wire carrying playback into a folder.
 * Unlinked subfolders (and everything under them) are skipped at every depth.
 * (`tracksUnder` keeps raw library/import order, which looks shuffled next to
 * the sorted window — never feed it to playback directly.)
 */
export function tracksUnderOrdered<T extends PathItem>(tracks: T[], dir: string, isLinked: IsLinked = () => true): T[] {
  const { files, folders } = readDir(tracks, dir);
  const out: T[] = [];
  for (const f of folders) if (isLinked(f.path)) out.push(...tracksUnderOrdered(tracks, f.path, isLinked));
  out.push(...files);
  return out;
}

/**
 * What plays AFTER the branch at `dir` finishes, when playback started inside a
 * subfolder of the window rooted at `root`: climb toward `root`, and at each
 * level append the OTHER linked subfolders (name order, skipping the branch just
 * played) and then that level's own files. The climb only happens while the
 * branch being left is itself linked — an UNLINKED subfolder plays alone, so the
 * queue ends there and the root's wire (if any) takes over directly. Empty when
 * `dir` is `root` itself (nothing above it inside the window).
 */
export function continuationAfter<T extends PathItem>(tracks: T[], dir: string, root: string, isLinked: IsLinked = () => true): T[] {
  const out: T[] = [];
  let child = dir;
  while (!samePath(child, root) && isUnder(child, root) && isLinked(child)) {
    const parent = dirOf(child);
    const { files, folders } = readDir(tracks, parent);
    for (const f of folders) {
      if (samePath(f.path, child) || !isLinked(f.path)) continue;
      out.push(...tracksUnderOrdered(tracks, f.path, isLinked));
    }
    out.push(...files);
    child = parent;
  }
  return out;
}

/**
 * One level of the tree: the immediate subfolders of `dir` (with recursive track
 * counts) and the tracks sitting directly in it. This is what an explorer window
 * paints.
 */
export function readDir<T extends PathItem>(tracks: T[], dir: string, isMissing: IsMissing = () => false): DirListing<T> {
  const sep = sepOf(dir);
  const files: T[] = [];
  const kids = new Map<string, { name: string; tracks: number; missing: number; subdirs: Set<string> }>();

  for (const track of tracks) {
    const p = track.nativePath;
    if (!p) continue;
    const home = dirOf(p);
    if (samePath(home, dir)) {
      files.push(track);
      continue;
    }
    if (!isUnder(home, dir)) continue;

    const rest = home.slice(dir.length + 1).split(SEGMENTS).filter(Boolean);
    const seg = rest[0];
    const k = key(seg);
    const entry = kids.get(k) ?? { name: seg, tracks: 0, missing: 0, subdirs: new Set<string>() };
    entry.tracks += 1;
    if (isMissing(p)) entry.missing += 1;
    if (rest.length > 1) entry.subdirs.add(key(rest[1]));
    kids.set(k, entry);
  }

  const folders: FolderEntry[] = [...kids.values()]
    .map((e) => ({
      path: dir + sep + e.name,
      name: e.name,
      trackCount: e.tracks,
      folderCount: e.subdirs.size,
      offline: e.tracks > 0 && e.missing === e.tracks,
    }))
    .sort(byName);

  files.sort((a, b) => byName({ name: a.name }, { name: b.name }));
  return { path: dir, folders, files };
}

interface Node {
  name: string;
  segs: string[];
  prefix: string;
  sep: string;
  dirs: Map<string, Node>;
  /** Tracks live directly in this folder (not just beneath it). */
  hasFiles: boolean;
}

/** Build a trie of every item's directory, keyed case-insensitively per level. */
function buildTrie<T extends PathItem>(tracks: T[]): Map<string, Node> {
  const tops = new Map<string, Node>();

  for (const track of tracks) {
    if (!track.nativePath) continue;
    const { prefix, segs, sep } = parse(dirOf(track.nativePath));
    if (segs.length === 0) continue;

    let level = tops;
    let node: Node | undefined;
    for (let i = 0; i < segs.length; i++) {
      const k = key(segs[i]);
      node = level.get(k);
      if (!node) {
        node = { name: segs[i], segs: segs.slice(0, i + 1), prefix, sep, dirs: new Map(), hasFiles: false };
        level.set(k, node);
      }
      level = node.dirs;
    }
    node!.hasFiles = true;
  }

  return tops;
}

/** Collapse a chain of single, file-less children down to the branch point. */
function collapse(node: Node): Node {
  let n = node;
  while (!n.hasFiles && n.dirs.size === 1) n = n.dirs.values().next().value!;
  return n;
}

/**
 * A bare Windows drive letter (`D:`) is NOT a real directory: `fs.watch('D:')`
 * and path ops resolve it to the *current directory* on that drive, not the
 * drive root. It shows up as a collapse target when several independent folders
 * on one drive share only the drive between them, and must be expanded before it
 * can be watched or navigated.
 */
function isBareDrive(node: Node): boolean {
  return node.prefix === '' && node.segs.length === 1 && /^[a-zA-Z]:$/.test(node.segs[0]);
}

/**
 * The folders to show on the desktop: one per import root.
 *
 * A trie of every track's directory is collapsed through single-child chains
 * that hold no files, so importing `D:\Music` with `Rock/` and `Jazz/` inside
 * yields one `Music` icon (the branch point) rather than a `D:` icon you have to
 * click through, or one flat icon per leaf folder. Everything below the root is
 * reached by drilling in.
 */
export function rootFolders<T extends PathItem>(tracks: T[], isMissing: IsMissing = () => false): FolderEntry[] {
  const roots: FolderEntry[] = [];
  for (const top of buildTrie(tracks).values()) {
    const node = collapse(top);
    const path = join(node.prefix, node.segs, node.sep);
    const under = tracksUnder(tracks, path);
    roots.push({
      path,
      name: baseName(path),
      trackCount: under.length,
      folderCount: node.dirs.size,
      offline: under.length > 0 && under.every((t) => isMissing(t.nativePath!)),
    });
  }
  return roots.sort(byName);
}

/**
 * The directories to hand the filesystem watcher for auto-import.
 *
 * Like `rootFolders`, but it never yields a bare drive letter. When several
 * independent top-level folders live on the same drive (`D:\MusicA`,
 * `D:\MusicB`), the shared collapse lands on `D:` — which `rootFolders` is happy
 * to show as one desktop icon, but which cannot actually be watched: `fs.watch`
 * treats `D:` as the cwd on that drive, so auto-import silently does nothing for
 * every such folder. Here each real folder is returned separately so all of them
 * are watched. (Songs sitting directly on a drive root fall back to watching the
 * drive root itself, `D:\`, which — unlike `D:` — is a real path.)
 */
export function watchRoots<T extends PathItem>(tracks: T[]): string[] {
  const out: string[] = [];
  const emit = (node: Node) => {
    const n = collapse(node);
    if (isBareDrive(n)) {
      // A bare drive is Windows-only, so its root is `D:\` — `n.sep` is unreliable
      // here (the drive segment carries no separator to infer style from).
      if (n.hasFiles) out.push(n.segs[0] + '\\');
      for (const child of n.dirs.values()) emit(child);
      return;
    }
    out.push(join(n.prefix, n.segs, n.sep));
  };
  for (const top of buildTrie(tracks).values()) emit(top);
  return out;
}
