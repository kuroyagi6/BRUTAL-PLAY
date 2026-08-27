import React from 'react';
import type { Track } from '../types';

/**
 * Tracks which native files are currently unreachable (e.g. an external drive
 * was removed, or after a cross-drive relink). Asks the main process to check
 * every distinct track path, re-running when the library changes and on window
 * focus (so reconnecting a drive clears the badges). Returns the set of missing
 * paths, lowercased. In a plain browser (no Electron bridge) it stays empty.
 */
export function useMissingPaths(playlist: Track[]): Set<string> {
  const [missingPaths, setMissingPaths] = React.useState<Set<string>>(new Set());

  const recheckMissing = React.useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.checkPaths) return; // browser fallback: nothing to check
    const paths = Array.from(new Set(playlist.map((tk) => tk.nativePath).filter(Boolean))) as string[];
    if (paths.length === 0) {
      setMissingPaths(new Set());
      return;
    }
    try {
      const missing: string[] = await api.checkPaths(paths);
      setMissingPaths(new Set(missing.map((p) => p.toLowerCase())));
    } catch (e) {
      /* ignore — leave previous state */
    }
  }, [playlist]);

  React.useEffect(() => {
    recheckMissing();
  }, [recheckMissing]);

  React.useEffect(() => {
    const onFocus = () => recheckMissing();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheckMissing]);

  return missingPaths;
}
