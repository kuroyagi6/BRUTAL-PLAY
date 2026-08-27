const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // defaultPath is optional — pass a folder to open the picker inside it.
  selectMusicFolder: (defaultPath) => ipcRenderer.invoke('select-music-folder', defaultPath),
  selectMusicFiles: () => ipcRenderer.invoke('select-music-files'),
  selectVideoFolder: () => ipcRenderer.invoke('select-video-folder'),
  readAudioFile: (path) => ipcRenderer.invoke('read-audio-file', path),
  // Pre-read the next track into the OS cache so its real read is fast. Bytes
  // never cross IPC; resolves false when it couldn't (missing file, or already
  // warming). Purely an optimisation — safe to ignore the result.
  warmAudioFile: (path) => ipcRenderer.invoke('warm-audio-file', path),
  checkPaths: (paths) => ipcRenderer.invoke('check-paths-exist', paths),
  scanMetadata: (paths) => ipcRenderer.invoke('scan-metadata', paths),
  // Online artist-profile lookup: fetch JSON from an allowlisted host (MusicBrainz
  // / Wikipedia / Wikidata) via main, which sets the User-Agent and rate-limits.
  // `opts` is optional: { bearer } for the one host that needs a credential
  // (api.genius.com, lyric annotations). Ignored for every other host.
  httpGetJson: (url, opts) => ipcRenderer.invoke('http-get-json', url, opts),
  // EXPERIMENTAL radio: current-track title + station name/favicon for a live
  // stream URL. Resolves null when the stream can't be reached.
  stationMetadata: (url) => ipcRenderer.invoke('station-metadata', url),
  // EXPERIMENTAL cloud sources: detected Google Drive / iCloud sync roots on this
  // machine. Filesystem detection only — there is no cloud login anywhere.
  detectCloudMounts: () => ipcRenderer.invoke('detect-cloud-mounts'),

  // EXPERIMENTAL Google Drive (Phase 2). Read-only. The user's own OAuth client;
  // sign-in happens in their real browser, so no password reaches the app.
  driveStatus: () => ipcRenderer.invoke('drive-status'),
  driveSetCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke('drive-set-credentials', clientId, clientSecret),
  driveConnect: () => ipcRenderer.invoke('drive-connect'),
  driveDisconnect: () => ipcRenderer.invoke('drive-disconnect'),
  driveForget: () => ipcRenderer.invoke('drive-forget'),
  driveList: () => ipcRenderer.invoke('drive-list'),
  driveDownload: (files) => ipcRenderer.invoke('drive-download', files),
  driveDownloadDir: () => ipcRenderer.invoke('drive-download-dir'),
  // Both return an unsubscribe function, like the other event bridges here.
  onDriveListProgress: (cb) => {
    const listener = (_evt, total) => cb(total);
    ipcRenderer.on('drive-list-progress', listener);
    return () => ipcRenderer.removeListener('drive-list-progress', listener);
  },
  onDriveDownloadProgress: (cb) => {
    const listener = (_evt, progress) => cb(progress);
    ipcRenderer.on('drive-download-progress', listener);
    return () => ipcRenderer.removeListener('drive-download-progress', listener);
  },
  // Returns an unsubscribe function so callers can't leak listeners across imports.
  onImportProgress: (cb) => {
    const listener = (_evt, progress) => cb(progress);
    ipcRenderer.on('import-progress', listener);
    return () => ipcRenderer.removeListener('import-progress', listener);
  },
  // Folder-watch auto-import. watchFolders replaces the watched set each call
  // (pass [] to stop watching); onFoldersChanged fires with the audio paths
  // under a root that just changed, and returns an unsubscribe.
  watchFolders: (paths) => ipcRenderer.invoke('watch-folders', paths),
  onFoldersChanged: (cb) => {
    const listener = (_evt, paths) => cb(paths);
    ipcRenderer.on('folders-changed', listener);
    return () => ipcRenderer.removeListener('folders-changed', listener);
  },

  // LAN remote server. start/stop/status return { running, ip, port, url }.
  remoteStart: () => ipcRenderer.invoke('remote-start'),
  remoteStop: () => ipcRenderer.invoke('remote-stop'),
  remoteStatus: () => ipcRenderer.invoke('remote-status'),
  // Fire-and-forget pushes to main (library index + now-playing state).
  remoteSetLibrary: (entries) => ipcRenderer.send('remote-set-library', entries),
  remoteSetVideos: (entries) => ipcRenderer.send('remote-set-videos', entries),
  remotePushState: (state) => ipcRenderer.send('remote-push-state', state),
  // Commands coming FROM a phone. Returns an unsubscribe to avoid leaks.
  onRemoteCommand: (cb) => {
    const listener = (_evt, cmd) => cb(cmd);
    ipcRenderer.on('remote-command', listener);
    return () => ipcRenderer.removeListener('remote-command', listener);
  },
  // Connected-device management (from the PC).
  remoteDevices: () => ipcRenderer.invoke('remote-devices'),
  remoteTrust: (id, trusted) => ipcRenderer.invoke('remote-trust', id, trusted),
  remoteKick: (id) => ipcRenderer.invoke('remote-kick', id),

  // ─── Cross-window PLAYER BUS ──────────────────────────────────────────────
  // Engine renderer publishes its serializable PlayerSnapshot (fire-and-forget).
  playerPublish: (snapshot) => ipcRenderer.send('player:publish', snapshot),
  // Any window subscribes to the broadcast snapshot. Returns an unsubscribe.
  onPlayerSnapshot: (cb) => {
    const listener = (_evt, snapshot) => cb(snapshot);
    ipcRenderer.on('player:snapshot', listener);
    return () => ipcRenderer.removeListener('player:snapshot', listener);
  },
  // High-rate progress patch (kept OFF the full-snapshot path — see protocol).
  playerPublishProgress: (patch) => ipcRenderer.send('player:progress', patch),
  onPlayerProgress: (cb) => {
    const listener = (_evt, patch) => cb(patch);
    ipcRenderer.on('player:progress', listener);
    return () => ipcRenderer.removeListener('player:progress', listener);
  },
  // Any window sends a PlayerCommand; the engine-side listener applies it.
  playerCommand: (cmd) => ipcRenderer.send('player:command', cmd),
  onPlayerCommand: (cb) => {
    const listener = (_evt, cmd) => cb(cmd);
    ipcRenderer.on('player:command', listener);
    return () => ipcRenderer.removeListener('player:command', listener);
  },
  // Pull the cached snapshot immediately on window open (null if none yet).
  playerRequestSnapshot: () => ipcRenderer.invoke('player:request-snapshot'),

  // ─── Visualizer stream ────────────────────────────────────────────────────
  // Client windows subscribe to request frames; the engine publishes them.
  vizSubscribe: () => ipcRenderer.send('viz:subscribe'),
  vizUnsubscribe: () => ipcRenderer.send('viz:unsubscribe'),
  onVizDemand: (cb) => {
    const listener = (_evt, active) => cb(active);
    ipcRenderer.on('viz:demand', listener);
    return () => ipcRenderer.removeListener('viz:demand', listener);
  },
  publishVizFrame: (buf) => ipcRenderer.send('viz:frame', buf),
  onVizFrame: (cb) => {
    const listener = (_evt, buf) => cb(buf);
    ipcRenderer.on('viz:frame', listener);
    return () => ipcRenderer.removeListener('viz:frame', listener);
  },

  // ─── Cross-window drag session ────────────────────────────────────────────
  // Source publishes the dragged track id; every window learns a drag is active.
  dndBegin: (trackId) => ipcRenderer.send('dnd:begin', trackId),
  dndEnd: () => ipcRenderer.send('dnd:end'),
  onDndActive: (cb) => {
    const listener = (_evt, trackId) => cb(trackId);
    ipcRenderer.on('dnd:active', listener);
    return () => ipcRenderer.removeListener('dnd:active', listener);
  },
  dndRequest: () => ipcRenderer.invoke('dnd:request'),

  // ─── Popped-out windows ───────────────────────────────────────────────────
  // Open a window in its own OS process (its content loads via ?window=<id>).
  windowOpen: (id) => ipcRenderer.invoke('window:open', id),
  windowClose: (id) => ipcRenderer.send('window:close', id),
  // Which window ids are currently popped out (for de-duping + the taskbar).
  onWindowList: (cb) => {
    const listener = (_evt, ids) => cb(ids);
    ipcRenderer.on('window:list', listener);
    return () => ipcRenderer.removeListener('window:list', listener);
  },
  windowRequestList: () => ipcRenderer.invoke('window:request-list'),
  // Dock a popped-out window back into the desktop (sent BY the popped window).
  windowDock: (id) => ipcRenderer.send('window:dock', id),
  // Desktop listens for dock requests so it can re-open the window in-document.
  onWindowDock: (cb) => {
    const listener = (_evt, id) => cb(id);
    ipcRenderer.on('window:dock', listener);
    return () => ipcRenderer.removeListener('window:dock', listener);
  },

  // ─── Auto-update ──────────────────────────────────────────────────────────
  // Purely optional UI hooks — updates download/install on their own without
  // these. onUpdateStatus streams { state, version?, percent?, message? }.
  onUpdateStatus: (cb) => {
    const listener = (_evt, status) => cb(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  // Restart now to apply a downloaded update (otherwise it applies on next quit).
  updateInstall: () => ipcRenderer.invoke('update:install'),
  // Manually re-check (e.g. a "check for updates" button).
  updateCheck: () => ipcRenderer.invoke('update:check'),
});
