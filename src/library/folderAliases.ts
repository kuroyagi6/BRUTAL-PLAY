import React from 'react';
import { baseName } from './folderTree';

// Display names for folder icons on the desktop.
//
// A rename here is a NICKNAME and nothing more: it is stored in localStorage
// against the folder's path and never touches the filesystem. The folder on
// disk keeps its real name, no files move, and nothing outside this app sees
// the change — clearing the alias shows the real name again. That is the whole
// point of the feature; if this ever needs to rename the actual directory it
// belongs in the Electron main process, not here.
//
// Same module-store shape as useIconLock: keyed by path, read through
// `folderLabel()`, subscribed with `useFolderAliases()`. Both music roots and
// video roots share it, since both draw as folder icons on the desktop.

const KEY = 'brutal-folder-aliases';

const load = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error(`Error reading ${KEY} from localStorage`, e);
    return {};
  }
};

// Replaced wholesale on write so the useSyncExternalStore snapshot stays stable
// between renders (a fresh object every read would loop forever).
let aliases: Readonly<Record<string, string>> = load();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** What to SHOW for a folder path: its nickname, else its real folder name. */
export const folderLabel = (path: string): string => aliases[path] || baseName(path);

/** The real on-disk name, for the "reset" affordance and dialog copy. */
export const realFolderName = (path: string): string => baseName(path);

/** True when this folder is showing a nickname rather than its real name. */
export const hasAlias = (path: string): boolean => !!aliases[path];

/**
 * Set a folder's display name. An empty/whitespace name, or one equal to the
 * real folder name, clears the alias instead of storing a redundant copy.
 */
export function renameFolder(path: string, name: string): void {
  const next = { ...aliases };
  const trimmed = name.trim();
  if (!trimmed || trimmed === baseName(path)) delete next[path];
  else next[path] = trimmed;
  aliases = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    console.error(`Error saving ${KEY} to localStorage`, e);
  }
  listeners.forEach((fn) => fn());
}

/**
 * Subscribe to the alias table. Call once in any component that renders folder
 * labels — the returned object is only an identity to re-render on; read the
 * actual names through `folderLabel()`.
 */
export function useFolderAliases(): Readonly<Record<string, string>> {
  return React.useSyncExternalStore(subscribe, () => aliases);
}
