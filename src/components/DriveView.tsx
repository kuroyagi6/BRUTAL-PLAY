import React from 'react';
import {
  Cloud, RefreshCw, Download, LogOut, KeyRound, Search, Music, Film, Loader, AlertTriangle, ExternalLink,
} from 'lucide-react';
import type { GoogleDriveApi } from '../hooks/useGoogleDrive';
import {
  classifyDrive, driveSize, totalBytes, filterDriveFiles, sortForDisplay, type DriveFile, type DriveKind,
} from '../cloud/driveFiles';
import { formatSize } from '../utils/format';

// EXPERIMENTAL Google Drive window (Phase 2 of cloud sources).
//
// Three states, in order: SET UP a Google OAuth client → CONNECT (sign in) →
// BROWSE + IMPORT. Importing downloads the chosen files to a real folder and
// then runs the ordinary importer, so Drive tracks become ordinary local tracks.
//
// The setup step exists because a desktop OAuth client secret cannot be kept
// secret (RFC 8252), so shipping one in the repo would be security theatre — the
// user supplies their own, and it is stored via the OS keychain.

interface DriveViewProps {
  drive: GoogleDriveApi;
  /** Hand downloaded paths to the ordinary library importer. */
  onImportPaths: (paths: string[]) => void;
}

const SETUP_STEPS = [
  'OPEN console.cloud.google.com → CREATE_A_PROJECT',
  'APIs_&_SERVICES → LIBRARY → ENABLE "GOOGLE_DRIVE_API"',
  'OAUTH_CONSENT_SCREEN → EXTERNAL → ADD_YOURSELF_UNDER_TEST_USERS',
  'CREDENTIALS → CREATE_CREDENTIALS → OAUTH_CLIENT_ID → TYPE: DESKTOP_APP',
  'PASTE_THE_CLIENT_ID_AND_SECRET_BELOW',
];

const SetupPanel: React.FC<{ drive: GoogleDriveApi }> = ({ drive }) => {
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  return (
    <div className="p-4">
      <h3 className="font-display text-lg uppercase mb-1 flex items-center gap-2">
        <KeyRound size={16} className="text-brutal-neon" /> ONE-TIME_SETUP
      </h3>
      <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-3 leading-relaxed">
        GOOGLE_REQUIRES_EACH_APP_TO_USE_ITS_OWN_OAUTH_CLIENT. A_SECRET_SHIPPED_IN_THE_CODE_COULD_BE
        _EXTRACTED_BY_ANYONE, SO_YOU_SUPPLY_YOUR_OWN. IT_IS_STORED_ENCRYPTED_BY_WINDOWS, NEVER_IN_THE_PROJECT.
      </p>

      <ol className="mb-4 space-y-1">
        {SETUP_STEPS.map((step, i) => (
          <li key={i} className="font-mono text-[10px] uppercase text-brutal-white/70 flex gap-2">
            <span className="text-brutal-neon shrink-0">{i + 1}.</span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      <a
        href="https://console.cloud.google.com/apis/credentials"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 mb-4 font-mono text-[10px] uppercase text-brutal-neon hover:underline"
      >
        <ExternalLink size={11} /> OPEN_GOOGLE_CLOUD_CONSOLE
      </a>

      <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">CLIENT_ID</label>
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="xxxxx.apps.googleusercontent.com"
        className="w-full mb-3 px-3 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-xs text-brutal-white"
      />

      <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">
        CLIENT_SECRET
      </label>
      <input
        type="password"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="GOCSPX-..."
        className="w-full mb-4 px-3 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-xs text-brutal-white"
      />

      <button
        onClick={() => drive.saveCredentials(clientId, clientSecret)}
        disabled={!clientId.trim() || drive.busy}
        className="w-full py-2 bg-brutal-neon text-brutal-black border-2 border-brutal-black font-mono text-xs uppercase font-bold disabled:opacity-40"
      >
        {drive.busy ? 'SAVING...' : 'SAVE_CREDENTIALS'}
      </button>
    </div>
  );
};

const FileRow: React.FC<{
  file: DriveFile;
  checked: boolean;
  onToggle: () => void;
}> = ({ file, checked, onToggle }) => {
  const kind = classifyDrive(file.mimeType);
  const size = driveSize(file);
  return (
    <button
      onClick={onToggle}
      className={`w-full px-2 py-1.5 flex items-center gap-2 border-b border-brutal-white/10 text-left transition-colors ${
        checked ? 'bg-brutal-neon/20' : 'hover:bg-brutal-white/5'
      }`}
    >
      <span
        className={`w-3.5 h-3.5 shrink-0 border-2 ${
          checked ? 'bg-brutal-neon border-brutal-neon' : 'border-brutal-white/40'
        }`}
      />
      {kind === 'video' ? (
        <Film size={13} className="shrink-0 text-brutal-white/50" />
      ) : (
        <Music size={13} className="shrink-0 text-brutal-neon" />
      )}
      <span className="flex-1 font-mono text-[11px] text-brutal-white truncate">{file.name}</span>
      <span className="font-mono text-[9px] text-brutal-white/40 shrink-0">
        {size > 0 ? formatSize(size) : '—'}
      </span>
    </button>
  );
};

const BrowsePanel: React.FC<DriveViewProps> = ({ drive, onImportPaths }) => {
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<DriveKind | 'all'>('all');
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  const visible = React.useMemo(
    () => sortForDisplay(filterDriveFiles(drive.files, { query, kind })),
    [drive.files, query, kind]
  );

  // Selections deliberately survive searching (filter to "doja", tick it, clear
  // the box, tick something else — both import). But they are taken from the
  // MEDIA-filtered list, never the raw one, so nothing that can't be a track can
  // reach the download call, and a file that vanished on refresh drops out.
  const picked = React.useMemo(
    () => filterDriveFiles(drive.files, {}).filter((f) => selected[f.id]),
    [drive.files, selected]
  );

  const toggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectAllVisible = () =>
    setSelected((prev) => {
      const next = { ...prev };
      const allOn = visible.every((f) => next[f.id]);
      for (const f of visible) next[f.id] = !allOn;
      return next;
    });

  const doImport = async () => {
    const { paths } = await drive.downloadFiles(picked);
    if (paths.length > 0) {
      onImportPaths(paths);
      setSelected({});
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Account bar */}
      <div className="px-3 py-2 border-b-2 border-brutal-white/20 flex items-center gap-2 shrink-0">
        <Cloud size={14} className="text-brutal-neon shrink-0" />
        <span className="font-mono text-[10px] uppercase text-brutal-white/70 truncate flex-1">
          {drive.status?.email ?? 'CONNECTED'}
        </span>
        <button
          onClick={drive.listFiles}
          disabled={drive.listing}
          title="Refresh the file list"
          className="px-2 py-1 border border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase flex items-center gap-1 disabled:opacity-40"
        >
          <RefreshCw size={10} className={drive.listing ? 'animate-spin' : ''} /> REFRESH
        </button>
        <button
          onClick={drive.disconnect}
          disabled={drive.busy}
          title="Sign out and revoke this app's access"
          className="px-2 py-1 border border-brutal-white/30 hover:border-red-500 hover:text-red-400 font-mono text-[9px] uppercase flex items-center gap-1 disabled:opacity-40"
        >
          <LogOut size={10} /> SIGN_OUT
        </button>
      </div>

      {/* Consent succeeded but Google withheld drive.readonly — say so here
          rather than let it surface later as an opaque 403 from files.list. */}
      {drive.status && drive.status.hasDriveScope === false && (
        <div className="px-3 py-2 bg-amber-500/15 border-b-2 border-amber-500 shrink-0">
          <p className="font-mono text-[9px] uppercase text-amber-300 leading-relaxed">
            SIGNED_IN_BUT_DRIVE_ACCESS_WAS_NOT_GRANTED.
            ADD_.../auth/drive.readonly_UNDER_GOOGLE_AUTH_PLATFORM &gt; DATA_ACCESS, PRESS_SAVE, THEN_SIGN_OUT_AND_IN_AGAIN.
          </p>
          <p className="mt-1 font-mono text-[9px] text-amber-200/60 break-all lowercase">
            granted: {drive.status.grantedScope || '(none reported)'}
          </p>
        </div>
      )}

      {/* Search + kind filter */}
      <div className="px-3 py-2 flex items-center gap-2 shrink-0">
        <div className="flex-1 flex items-center gap-1 px-2 py-1 bg-brutal-black border-2 border-brutal-white/20 focus-within:border-brutal-neon">
          <Search size={11} className="text-brutal-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="FILTER..."
            className="w-full bg-transparent outline-none font-mono text-[11px] text-brutal-white"
          />
        </div>
        {(['all', 'audio', 'video'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`px-2 py-1 border font-mono text-[9px] uppercase ${
              kind === k
                ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                : 'border-brutal-white/30 hover:border-brutal-neon'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto border-y border-brutal-white/10">
        {drive.listing ? (
          <p className="p-4 font-mono text-[10px] uppercase text-brutal-white/50 flex items-center gap-2">
            <Loader size={12} className="animate-spin" /> SCANNING_DRIVE... {drive.listedCount || ''}
          </p>
        ) : drive.files.length === 0 ? (
          <p className="p-4 font-mono text-[10px] uppercase text-brutal-white/40 leading-relaxed">
            NO_FILES_LOADED_YET. PRESS_REFRESH_TO_SCAN_YOUR_DRIVE_FOR_AUDIO_AND_VIDEO.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 font-mono text-[10px] uppercase text-brutal-white/40">NO_MATCHES.</p>
        ) : (
          visible.map((f) => (
            <FileRow key={f.id} file={f} checked={!!selected[f.id]} onToggle={() => toggle(f.id)} />
          ))
        )}
      </div>

      {/* Import bar */}
      <div className="px-3 py-2 shrink-0 space-y-2">
        {drive.downloading && drive.progress && (
          <p className="font-mono text-[9px] uppercase text-brutal-neon truncate">
            DOWNLOADING {drive.progress.done}/{drive.progress.total}
            {drive.progress.name ? ` // ${drive.progress.name}` : ''}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={selectAllVisible}
            disabled={visible.length === 0}
            className="px-2 py-2 border-2 border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase disabled:opacity-40"
          >
            TOGGLE_ALL
          </button>
          <button
            onClick={doImport}
            disabled={picked.length === 0 || drive.downloading}
            className="flex-1 py-2 bg-brutal-neon text-brutal-black border-2 border-brutal-black font-mono text-xs uppercase font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Download size={13} />
            {drive.downloading
              ? 'IMPORTING...'
              : `IMPORT_${picked.length}_FILE${picked.length === 1 ? '' : 'S'}${
                  picked.length > 0 ? ` // ${formatSize(totalBytes(picked))}` : ''
                }`}
          </button>
        </div>
        {/* Importing copies bytes onto this PC — say so rather than surprise them. */}
        {drive.downloadDir && (
          <p className="font-mono text-[9px] uppercase text-brutal-white/30 truncate">
            DOWNLOADS_TO: {drive.downloadDir}
          </p>
        )}
      </div>
    </div>
  );
};

export const DriveView: React.FC<DriveViewProps> = ({ drive, onImportPaths }) => {
  const status = drive.status;

  return (
    <div className="h-full flex flex-col min-h-0 bg-brutal-black text-brutal-white">
      {drive.error && (
        <div className="px-3 py-2 bg-red-500/15 border-b-2 border-red-500 flex items-start gap-2 shrink-0">
          <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
          <p className="flex-1 font-mono text-[10px] uppercase text-red-300 leading-relaxed break-words">
            {drive.error}
          </p>
          <button
            onClick={drive.clearError}
            className="font-mono text-[9px] uppercase text-red-300 hover:text-brutal-white shrink-0"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* No OS keychain means we would have to write the secret in plaintext,
          which this layer refuses to do. */}
      {status && !status.encryptionAvailable ? (
        <p className="p-4 font-mono text-[10px] uppercase text-red-300 leading-relaxed">
          OS_SECURE_STORAGE_UNAVAILABLE // REFUSING_TO_STORE_CREDENTIALS_IN_PLAINTEXT.
          GOOGLE_DRIVE_SIGN-IN_IS_DISABLED_ON_THIS_MACHINE.
        </p>
      ) : !status ? (
        <p className="p-4 font-mono text-[10px] uppercase text-brutal-white/40">
          DESKTOP_APP_ONLY // GOOGLE_DRIVE_NEEDS_THE_ELECTRON_BUILD.
        </p>
      ) : !status.configured ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SetupPanel drive={drive} />
        </div>
      ) : !status.connected ? (
        <div className="p-4">
          <h3 className="font-display text-lg uppercase mb-2 flex items-center gap-2">
            <Cloud size={16} className="text-brutal-neon" /> CONNECT_GOOGLE_DRIVE
          </h3>
          <p className="font-mono text-[10px] text-brutal-white/50 uppercase mb-4 leading-relaxed">
            SIGN-IN_OPENS_IN_YOUR_OWN_BROWSER — THIS_APP_NEVER_SEES_YOUR_PASSWORD.
            ACCESS_IS_READ-ONLY: IT_CAN_LIST_AND_DOWNLOAD, NEVER_MODIFY_OR_DELETE.
          </p>
          <button
            onClick={drive.connect}
            disabled={drive.busy}
            className="w-full py-2 mb-2 bg-brutal-neon text-brutal-black border-2 border-brutal-black font-mono text-xs uppercase font-bold disabled:opacity-40"
          >
            {drive.busy ? 'WAITING_FOR_BROWSER...' : 'SIGN_IN_WITH_GOOGLE'}
          </button>
          <button
            onClick={drive.forget}
            disabled={drive.busy}
            className="w-full py-1.5 border border-brutal-white/20 hover:border-red-500 hover:text-red-400 font-mono text-[9px] uppercase disabled:opacity-40"
          >
            FORGET_SAVED_CREDENTIALS
          </button>
        </div>
      ) : (
        <BrowsePanel drive={drive} onImportPaths={onImportPaths} />
      )}
    </div>
  );
};
