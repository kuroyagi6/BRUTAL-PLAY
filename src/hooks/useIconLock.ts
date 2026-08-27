import React from 'react';

// Which desktop icons are pinned in place. A pinned icon still opens, still
// wires, still gets clamped back on screen — it just can't be dragged, so a
// stray press on a carefully placed tile can't shuffle the desktop.
//
// This is a module-level store rather than App state on purpose: DesktopIcon
// wraps EVERY icon kind (folders, playlists, videos, stations, YouTube, pins,
// widgets), and threading a `locked` prop through all six Desktop* components
// would touch six working files for one boolean. Here DesktopIcon subscribes
// itself by id, and only the icon whose lock changed re-renders.
//
// Ids are the same ones the position store uses (`folder:<path>`,
// `playlist:<id>`, `video:<path>`, `<album|artist>:<key>`, …), so a lock
// follows the icon it was set on.

const KEY = 'brutal-locked-icons';

const load = (): Set<string> => {
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch (e) {
    console.error(`Error reading ${KEY} from localStorage`, e);
    return new Set();
  }
};

// Replaced wholesale on every change (never mutated) so the snapshot read by
// useSyncExternalStore is always a consistent value.
let locked: ReadonlySet<string> = load();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const isIconLocked = (id: string): boolean => locked.has(id);

/** Pin an unpinned icon, unpin a pinned one. Persists immediately. */
export function toggleIconLock(id: string): void {
  const next = new Set(locked);
  if (!next.delete(id)) next.add(id);
  locked = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch (e) {
    console.error(`Error saving ${KEY} to localStorage`, e);
  }
  listeners.forEach((fn) => fn());
}

/** Subscribe one icon to its own lock flag. Returns a plain boolean snapshot. */
export function useIconLocked(id: string): boolean {
  return React.useSyncExternalStore(subscribe, () => locked.has(id));
}
