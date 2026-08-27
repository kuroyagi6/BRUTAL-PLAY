import React from 'react';
import { usePersistentState } from './usePersistentState';
import { toCloudSources, type CloudSource, type RawCloudMount } from '../cloud/cloudSources';

// EXPERIMENTAL cloud-sources layer. Finds the folders Google Drive for Desktop
// and iCloud for Windows already sync to this machine and offers them as desktop
// icons that feed the ORDINARY folder importer.
//
// Contained by construction: this hook owns no audio, touches no queue, and has
// no engine coupling at all. It hands App a list of paths; importing one is the
// same code path as picking a folder by hand. Nothing here can break playback.
//
// Two things it deliberately does NOT do:
//  - No cloud API and no login. Both clouds are read as plain directories. In
//    iCloud's case that is the only option that exists — Apple publishes no
//    iCloud Drive API, so a "sign in to iCloud" button could not be honest.
//  - No bulk import of a whole cloud root. Google Drive streams files on demand,
//    so a folder can list songs whose bytes aren't on disk yet; scanning the lot
//    would force-download the entire Drive. Tiles open the folder PICKER rooted
//    at the cloud, so the user chooses a real music subfolder.

export interface CloudSourcesApi {
  /** Detected roots, minus any the user hid. */
  sources: CloudSource[];
  /** True while a detection pass is in flight. */
  scanning: boolean;
  /** True once detection has completed at least once (so "none found" is real). */
  scanned: boolean;
  /** Re-run detection — e.g. after signing into another Drive account. */
  rescan: () => void;
  /** Hide a tile without touching the filesystem. */
  hideSource: (id: string) => void;
  /** Bring every hidden tile back. */
  showAllSources: () => void;
  hiddenCount: number;
}

const HIDDEN_KEY = 'brutal-cloudHidden';

/**
 * @param enabled Opt-in flag (`brutal-cloudEnabled`). While false this hook does
 *   nothing at all — no IPC, no detection, no PowerShell probe.
 */
export function useCloudSources(enabled: boolean): CloudSourcesApi {
  const [hidden, setHidden] = usePersistentState<string[]>(HIDDEN_KEY, []);
  const [detected, setDetected] = React.useState<CloudSource[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const [scanned, setScanned] = React.useState(false);
  // Bumping this re-runs detection; it's the whole implementation of rescan().
  const [scanNonce, setScanNonce] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) {
      // Turning the layer off forgets what we found, so re-enabling re-detects
      // rather than showing a stale drive that has since been unmounted.
      setDetected([]);
      setScanned(false);
      return;
    }

    const detect: (() => Promise<RawCloudMount[]>) | undefined = (window as any).electronAPI
      ?.detectCloudMounts;
    if (!detect) {
      // Browser build: no filesystem, so there is nothing to find. Mark it
      // scanned so the UI shows "none found" instead of spinning forever.
      setScanned(true);
      return;
    }

    let cancelled = false;
    setScanning(true);
    detect()
      .then((raws) => {
        if (cancelled) return;
        setDetected(toCloudSources(Array.isArray(raws) ? raws : []));
      })
      .catch((e) => {
        // A failed probe is "no clouds", not a broken app.
        console.warn('Cloud detection failed:', e);
        if (!cancelled) setDetected([]);
      })
      .finally(() => {
        if (cancelled) return;
        setScanning(false);
        setScanned(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, scanNonce]);

  const rescan = React.useCallback(() => setScanNonce((n) => n + 1), []);

  const hideSource = React.useCallback(
    (id: string) => setHidden((prev) => (prev.includes(id) ? prev : [...prev, id])),
    [setHidden]
  );

  const showAllSources = React.useCallback(() => setHidden([]), [setHidden]);

  const sources = React.useMemo(
    () => detected.filter((s) => !hidden.includes(s.id)),
    [detected, hidden]
  );

  // Only count hidden entries we actually detected — a drive that's no longer
  // mounted shouldn't inflate "N hidden" with a tile we couldn't restore.
  const hiddenCount = React.useMemo(
    () => detected.filter((s) => hidden.includes(s.id)).length,
    [detected, hidden]
  );

  return { sources, scanning, scanned, rescan, hideSource, showAllSources, hiddenCount };
}
