import React from 'react';
import type { DriveFile } from '../cloud/driveFiles';

// EXPERIMENTAL Google Drive layer (Phase 2 of cloud sources).
//
// Phase 1 (useCloudSources) reads Drive's already-synced FOLDER and needs no
// login. This hook exists for the one thing that cannot do: reach files that
// live in the Google account but were never downloaded to disk.
//
// Contained the same way everything else is: this hook owns no audio and knows
// nothing about the queue or the engine. Importing DOWNLOADS the chosen files to
// a real folder and hands the local paths back to App, which feeds them to the
// ordinary importer — so a Drive track becomes an ordinary local track and every
// existing feature (metadata, EQ, visualizer, offline play) works untouched.
//
// All Google contact happens in main (electron/googleAuth.cjs + googleDrive.cjs).
// The renderer never sees a token, and the user signs in through their own
// browser, so no password passes through the app.

export interface DriveStatus {
  /** Has the user supplied their own Google Cloud OAuth client yet? */
  configured: boolean;
  /** Is there a working session (refresh token)? */
  connected: boolean;
  email: string | null;
  /** False on a machine with no OS keychain — we refuse to store secrets then. */
  encryptionAvailable: boolean;
  /** Scopes Google actually granted (from the token response), space-separated. */
  grantedScope?: string | null;
  /**
   * Whether drive.readonly is among them. Consent can succeed while Google
   * silently drops a restricted scope that isn't declared on the consent
   * screen — this is how the UI catches that before the API 403s.
   */
  hasDriveScope?: boolean;
}

export interface DownloadProgress {
  done: number;
  total: number;
  name: string | null;
}

export interface GoogleDriveApi {
  status: DriveStatus | null;
  /** True while any auth call (connect/disconnect/save) is in flight. */
  busy: boolean;
  files: DriveFile[];
  listing: boolean;
  /** Running count while a large Drive is being paged through. */
  listedCount: number;
  downloading: boolean;
  progress: DownloadProgress | null;
  /** Last failure, shown in the window. Cleared by the next successful action. */
  error: string | null;
  /** Where imported files are written, for the "files live here" line. */
  downloadDir: string | null;

  saveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  forget: () => Promise<void>;
  listFiles: () => Promise<void>;
  /** Download the given files; resolves the local paths that landed. */
  downloadFiles: (files: DriveFile[]) => Promise<{ paths: string[]; failed: { name: string; error: string }[] }>;
  clearError: () => void;
}

const api = () => (window as any).electronAPI;

/** Strip Electron's IPC wrapper so the UI shows Google's actual complaint. */
function cleanError(e: unknown): string {
  const raw = String((e as any)?.message ?? e ?? 'Unknown error');
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}

export function useGoogleDrive(enabled: boolean): GoogleDriveApi {
  const [status, setStatus] = React.useState<DriveStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [files, setFiles] = React.useState<DriveFile[]>([]);
  const [listing, setListing] = React.useState(false);
  const [listedCount, setListedCount] = React.useState(0);
  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadDir, setDownloadDir] = React.useState<string | null>(null);

  // Initial status + where downloads go. Gated on `enabled` so a disabled layer
  // performs no IPC at all.
  React.useEffect(() => {
    if (!enabled || !api()?.driveStatus) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    api()
      .driveStatus()
      .then((s: DriveStatus) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* leave status null — the UI treats that as "not set up" */
      });
    api()
      .driveDownloadDir?.()
      .then((d: string) => {
        if (!cancelled) setDownloadDir(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Progress events while a listing walks pages / a download runs.
  React.useEffect(() => {
    if (!enabled) return;
    const offList = api()?.onDriveListProgress?.((total: number) => setListedCount(total));
    const offDown = api()?.onDriveDownloadProgress?.((p: DownloadProgress) => setProgress(p));
    return () => {
      offList?.();
      offDown?.();
    };
  }, [enabled]);

  /** Every auth action shares this shape: busy on, clear error, refresh status. */
  const runAuth = React.useCallback(async (fn: () => Promise<DriveStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveCredentials = React.useCallback(
    (clientId: string, clientSecret: string) =>
      runAuth(() => api().driveSetCredentials(clientId, clientSecret)),
    [runAuth]
  );

  const connect = React.useCallback(() => runAuth(() => api().driveConnect()), [runAuth]);

  const disconnect = React.useCallback(async () => {
    await runAuth(() => api().driveDisconnect());
    // A disconnected session must not leave a browsable file list behind.
    setFiles([]);
    setListedCount(0);
  }, [runAuth]);

  const forget = React.useCallback(async () => {
    await runAuth(() => api().driveForget());
    setFiles([]);
    setListedCount(0);
  }, [runAuth]);

  const listFiles = React.useCallback(async () => {
    setListing(true);
    setError(null);
    setListedCount(0);
    try {
      setFiles(await api().driveList());
    } catch (e) {
      setError(cleanError(e));
      setFiles([]);
    } finally {
      setListing(false);
    }
  }, []);

  const downloadFiles = React.useCallback(async (picked: DriveFile[]) => {
    if (picked.length === 0) return { paths: [], failed: [] };
    setDownloading(true);
    setError(null);
    setProgress({ done: 0, total: picked.length, name: null });
    try {
      const result = await api().driveDownload(picked);
      if (result.failed?.length) {
        setError(`${result.failed.length} FILE(S) FAILED: ${result.failed[0].error}`);
      }
      return result;
    } catch (e) {
      setError(cleanError(e));
      return { paths: [], failed: [] };
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }, []);

  const clearError = React.useCallback(() => setError(null), []);

  return {
    status,
    busy,
    files,
    listing,
    listedCount,
    downloading,
    progress,
    error,
    downloadDir,
    saveCredentials,
    connect,
    disconnect,
    forget,
    listFiles,
    downloadFiles,
    clearError,
  };
}
