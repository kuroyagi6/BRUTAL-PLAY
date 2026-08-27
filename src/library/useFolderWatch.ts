import React from 'react';
import type { Track } from '../types';
import { watchRoots } from './folderTree';
import type { ImportProgress } from './useMediaLibrary';

// Folder-watch auto-import, kept as a SELF-CONTAINED hook composed at the App
// level. It never touches useMediaLibrary or useAudioPlayer — it only reads the
// current library (to know which roots to watch) and drives the *existing*
// addNativeFiles, whose own de-dupe guarantees a re-scan can't double-add. The
// watched roots are derived, not stored: the same rootFolders() the desktop icons
// use, so watching tracks the library automatically as folders come and go.

interface WatchBridge {
  watchFolders?: (paths: string[]) => Promise<void>;
  onFoldersChanged?: (cb: (paths: string[]) => void) => () => void;
}

type AddNativeFiles = (
  paths: string[],
  onProgress?: (p: ImportProgress) => void
) => Promise<{ added: number; skipped: number; persistFailed: number }>;

export interface UseFolderWatchArgs {
  /** When false, all watchers are torn down and nothing auto-imports. */
  enabled: boolean;
  /** The live library — watched roots are derived from it. */
  playlist: Track[];
  /** The library's importer; its de-dupe makes repeated scans safe. */
  addNativeFiles: AddNativeFiles;
  /** Called after an auto-import actually added tracks, for UI status. */
  onAutoImported?: (added: number) => void;
}

const lower = (p: string) => p.toLowerCase();

export function useFolderWatch({
  enabled,
  playlist,
  addNativeFiles,
  onAutoImported,
}: UseFolderWatchArgs): void {
  // The import roots to watch. Derived like the desktop's branch-point folders,
  // but never a bare drive letter (see watchRoots) — several folders on one drive
  // collapse to `D:` for the desktop, which cannot be watched.
  const roots = React.useMemo(() => watchRoots(playlist), [playlist]);
  // A stable primitive so the watch effect only re-runs when the set truly changes.
  const rootsKey = React.useMemo(() => roots.map(lower).sort().join('|'), [roots]);

  // Keep the newest importer/callback reachable from the mount-once subscription
  // without making it a dependency (which would re-subscribe on every render).
  const addRef = React.useRef(addNativeFiles);
  const onAddedRef = React.useRef(onAutoImported);
  React.useEffect(() => {
    addRef.current = addNativeFiles;
    onAddedRef.current = onAutoImported;
  }, [addNativeFiles, onAutoImported]);

  // Paths we've already handed to the importer this session. addNativeFiles reads
  // React state for its own de-dupe, which can lag a burst of change events; this
  // ref is authoritative regardless of render timing, so nothing is added twice.
  const handledRef = React.useRef<Set<string>>(new Set());

  // Subscribe to change pushes exactly once.
  React.useEffect(() => {
    const api = (window as any).electronAPI as WatchBridge | undefined;
    if (!api?.onFoldersChanged) return;

    const unsubscribe = api.onFoldersChanged((paths) => {
      const fresh = (paths || []).filter((p) => {
        const k = lower(p);
        if (handledRef.current.has(k)) return false;
        handledRef.current.add(k);
        return true;
      });
      if (fresh.length === 0) return;

      // Best-effort: a failed auto-import must never surface as a crash.
      addRef.current(fresh)
        .then(({ added }) => {
          if (added > 0) onAddedRef.current?.(added);
        })
        .catch((e) => console.warn('Auto-import from folder watch failed:', e));
    });
    return unsubscribe;
  }, []);

  // Push the watched set to main whenever it changes (or the feature is toggled).
  React.useEffect(() => {
    const api = (window as any).electronAPI as WatchBridge | undefined;
    if (!api?.watchFolders) return;
    api.watchFolders(enabled ? roots : []).catch((e) =>
      console.warn('Could not update watched folders:', e)
    );
    // rootsKey stands in for `roots`; both derive from the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootsKey]);
}
