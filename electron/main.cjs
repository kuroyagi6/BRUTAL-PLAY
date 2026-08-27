const { app, BrowserWindow, protocol, net, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { scanMetadata } = require('./scanMetadata.cjs');
const { createLocalMediaHandler } = require('./localMediaProtocol.cjs');
const { collectAudioFiles, collectVideoFiles, createFolderWatcher } = require('./folderWatcher.cjs');
const { createRemoteServer } = require('./remoteServer.cjs');
const { httpGetJson } = require('./httpGet.cjs');
const { fetchIcyNowPlaying } = require('./icyMetadata.cjs');
const { detectCloudMounts } = require('./cloudMounts.cjs');
const googleAuth = require('./googleAuth.cjs');
const googleDrive = require('./googleDrive.cjs');
const { initAutoUpdate } = require('./autoUpdate.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
]);

// Cache of original path -> discovered path so we don't re-scan on every range request
const resolvedPathCache = new Map();

// Lazily-created filesystem watcher for auto-import, plus the webContents that
// asked for it (refreshed each request so a reload can't leave us sending to a
// dead renderer). See electron/folderWatcher.cjs.
let folderWatcher = null;
let watchSender = null;

// The main window, kept module-level so the LAN remote server can forward phone
// commands to the renderer. The remote server itself is lazily created on first
// enable and reused across on/off toggles.
let mainWindow = null;
let remoteServer = null;

// ─── Cross-window PLAYER BUS ────────────────────────────────────────────────
// The hub that lets the audio engine live in ONE renderer while every other
// window drives it over IPC (see src/player/playerProtocol.ts). Main only
// relays: it caches the latest snapshot so a window opening late gets state
// immediately, broadcasts snapshots to every renderer, and forwards commands to
// every renderer (the engine-side hook applies them; other windows ignore).
let playerSnapshot = null;

// Send to every open renderer. Used for both snapshots and commands so this
// works unchanged once windows become separate BrowserWindows.
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    // During a window's own teardown its 'destroyed' handler can trigger a
    // broadcast while the window still reports !isDestroyed() but its
    // webContents is already gone — check the webContents too, and guard the
    // send, so closing a popped-out window can't throw "Object has been destroyed".
    const wc = !w.isDestroyed() && w.webContents;
    if (wc && !wc.isDestroyed()) {
      try {
        wc.send(channel, payload);
      } catch {
        /* window went away mid-broadcast — ignore */
      }
    }
  }
}

const IS_DEV = process.env.NODE_ENV === 'development';

// ─── Popped-out windows ─────────────────────────────────────────────────────
// A window "popped out" of the desktop becomes its own BrowserWindow (its own
// process → own heap + thread, so it can't block the desktop). It loads the SAME
// bundle with ?window=<id>; main.tsx renders just that window's content as a bus
// client. Keyed by id so re-popping focuses the existing one instead of
// duplicating. The desktop window and all IPC/protocol handlers are shared, so a
// child window has the full electronAPI (player bus included) with no extra setup.
const childWindows = new Map(); // id -> BrowserWindow

function openChildWindow(id) {
  const existing = childWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'BRUTAL // ' + String(id).toUpperCase(),
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Keep rAF/timers running when this window is backgrounded so a popped-out
      // visualizer keeps animating even when the window isn't focused.
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
  });
  childWindows.set(id, win);
  win.on('closed', () => {
    childWindows.delete(id);
    broadcastWindowList();
  });
  if (IS_DEV) {
    win.loadURL('http://localhost:3042/?window=' + encodeURIComponent(id));
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { window: id } });
  }
  broadcastWindowList();
}

// Tell every window which ids are currently popped out, so the desktop can skip
// rendering an in-document copy (no duplicates) and reflect them in the taskbar.
function broadcastWindowList() {
  broadcast('window:list', Array.from(childWindows.keys()));
}

// Load the remote PIN from userData, creating+persisting one on first use so it
// stays the same across app restarts (the phone doesn't have to re-learn it).
function loadOrCreateRemotePin() {
  try {
    const file = path.join(app.getPath('userData'), 'remote-pin');
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (/^\d{4}$/.test(v)) return v;
    }
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    fs.writeFileSync(file, pin, 'utf8');
    return pin;
  } catch (e) {
    console.error('Could not persist remote PIN:', e);
    return null; // server falls back to an ephemeral PIN
  }
}

// Device registry persistence (trust survives restart). Kept alongside the PIN
// in userData. A device carries its cookie token, so a phone that still has the
// cookie is recognised — and stays trusted — after a restart.
function remoteDevicesFile() {
  return path.join(app.getPath('userData'), 'remote-devices.json');
}
function loadRemoteDevices() {
  try {
    const j = JSON.parse(fs.readFileSync(remoteDevicesFile(), 'utf8'));
    return Array.isArray(j.devices) ? j.devices : [];
  } catch (e) {
    return [];
  }
}
function saveRemoteDevices(list) {
  try {
    fs.writeFileSync(remoteDevicesFile(), JSON.stringify({ devices: list }), 'utf8');
  } catch (e) {
    console.error('Could not persist remote devices:', e);
  }
}

function getRemoteServer() {
  if (!remoteServer) {
    remoteServer = createRemoteServer({
      resolveExistingPath,
      pin: loadOrCreateRemotePin(),
      loadDevices: loadRemoteDevices,
      saveDevices: saveRemoteDevices,
    });
    remoteServer.onCommand((cmd) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remote-command', cmd);
      }
    });
  }
  return remoteServer;
}

// Short-lived cache of currently-mounted Windows drive roots, so cross-drive
// relink doesn't re-probe all 26 letters for every file.
let driveCache = { at: 0, drives: [] };
function existingDrives() {
  const now = Date.now();
  if (now - driveCache.at < 3000) return driveCache.drives;
  const drives = [];
  for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    try { if (fs.existsSync(l + ':\\')) drives.push(l); } catch (e) { /* ignore */ }
  }
  driveCache = { at: now, drives };
  return drives;
}

function findFileByName(dir, fileNameLower, depth = 0) {
  if (depth > 5) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === fileNameLower) {
      return path.join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileByName(path.join(dir, entry.name), fileNameLower, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Resolve a stored path to a file that actually exists on disk. Handles files
// that were moved/renamed with different casing by searching from the nearest
// existing ancestor. Returns the real path, or null if nothing matches.
// Shared by the metadata protocol handler and the playback IPC channel.
function resolveExistingPath(rawPath) {
  if (!rawPath) return null;
  if (fs.existsSync(rawPath)) return rawPath;

  const cached = resolvedPathCache.get(rawPath);
  if (cached && fs.existsSync(cached)) return cached;

  try {
    let searchRoot = path.dirname(rawPath);
    while (searchRoot && !fs.existsSync(searchRoot)) {
      const parent = path.dirname(searchRoot);
      if (parent === searchRoot) break;
      searchRoot = parent;
    }
    if (fs.existsSync(searchRoot)) {
      const found = findFileByName(searchRoot, path.basename(rawPath).toLowerCase());
      if (found) {
        resolvedPathCache.set(rawPath, found);
        return found;
      }
    }
  } catch (e) { /* fall through */ }

  // Cross-drive relink (Windows): an external drive may have reconnected under a
  // different letter. Try the same path-without-drive on every other mounted
  // drive — fixes E:\... -> F:\... automatically.
  try {
    if (process.platform === 'win32' && /^[A-Za-z]:[\\/]/.test(rawPath)) {
      const suffix = rawPath.slice(2); // keeps the leading separator
      const origLetter = rawPath[0].toUpperCase();
      for (const letter of existingDrives()) {
        if (letter === origLetter) continue;
        const candidate = letter + ':' + suffix;
        if (fs.existsSync(candidate)) {
          resolvedPathCache.set(rawPath, candidate);
          return candidate;
        }
      }
    }
  } catch (e) { /* fall through */ }

  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // The desktop window PRODUCES the visualizer frames for popped-out windows
      // via a requestAnimationFrame loop. Without this, Chromium throttles that
      // loop whenever the desktop isn't the focused window, so a popped-out
      // visualizer freezes. Keep timers running while backgrounded.
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3042');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  protocol.handle('local-media', createLocalMediaHandler({ resolveExistingPath }));

  // Playback channel: return the full file bytes so the renderer can build an
  // in-memory blob: URL. Blob URLs are natively seekable, which eliminates the
  // range-request/demuxer errors that broke scrubbing.
  ipcMain.handle('read-audio-file', async (_evt, rawPath) => {
    const resolved = resolveExistingPath(rawPath);
    if (!resolved) {
      throw new Error('File not found: ' + rawPath);
    }
    const buf = await fs.promises.readFile(resolved);
    // Return an ArrayBuffer slice so it transfers as a Uint8Array in the renderer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  // Pull a file through the OS page cache and throw the bytes away.
  //
  // Why: 'read-audio-file' above is the whole latency of a track change — it
  // can't start until you press next, and on a cold cache, an external drive, or
  // a cloud-synced folder the disk read dominates. Warming the NEXT track while
  // the current one plays moves that read off the critical path, so the real
  // read later hits RAM instead of the platter.
  //
  // Deliberately returns nothing: no bytes cross IPC, nothing is retained here,
  // and the renderer's playback path is untouched. Worst case this is a no-op
  // that wasted some background I/O. Never throws — a warm failing is not an
  // error worth surfacing, the real read will report it properly.
  const warming = new Set();
  ipcMain.handle('warm-audio-file', async (_evt, rawPath) => {
    const resolved = resolveExistingPath(rawPath);
    // Already in flight → don't queue a second read of the same file.
    if (!resolved || warming.has(resolved)) return false;
    warming.add(resolved);
    try {
      // Streamed so main's heap never holds the file; the point is the page
      // cache, not the buffer. 1 MB chunks keep the syscall count sane.
      // Resolves either way — an error is reported as false, never thrown.
      return await new Promise((resolve) => {
        const rs = fs.createReadStream(resolved, { highWaterMark: 1024 * 1024 });
        rs.on('data', () => {});
        rs.on('end', () => resolve(true));
        rs.on('error', () => resolve(false));
        rs.on('close', () => resolve(false)); // only wins if 'end' never fired
      });
    } catch {
      return false;
    } finally {
      warming.delete(resolved);
    }
  });

  // Online artist-profile lookup. The renderer's resolver (src/services/
  // artistProfile.ts) drives the sequence and passes each URL here; main enforces
  // the host allowlist, sets the required User-Agent, and rate-limits. See
  // electron/httpGet.cjs.
  // `opts` currently carries only { bearer } for the Genius annotations lookup;
  // httpGet ignores it for every host not marked as needing auth.
  ipcMain.handle('http-get-json', (_evt, url, opts) => httpGetJson(url, opts));

  // EXPERIMENTAL radio: read ICY now-playing metadata (StreamTitle) + station
  // name/favicon from a live stream. Returns null if unreachable. See
  // electron/icyMetadata.cjs.
  ipcMain.handle('station-metadata', (_evt, url) => fetchIcyNowPlaying(url));

  // Batch metadata scan for import. See electron/scanMetadata.cjs for why this
  // lives in main rather than the renderer.
  ipcMain.handle('scan-metadata', (evt, paths) =>
    scanMetadata(paths, resolveExistingPath, (progress) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('import-progress', progress);
    })
  );

  // Return which of the given native paths are currently unreachable (checked
  // through resolveExistingPath, so cross-drive-relinked files count as present).
  ipcMain.handle('check-paths-exist', async (_evt, paths) => {
    if (!Array.isArray(paths)) return [];
    const missing = [];
    for (const p of paths) {
      if (!resolveExistingPath(p)) missing.push(p);
    }
    return missing;
  });

  // Folder-watch auto-import: the renderer sends the set of root folders to watch
  // (derived from the library); whenever one changes, we push its full current
  // audio-file list back over 'folders-changed'. The renderer de-dupes against
  // the library, so already-known paths are ignored and only new songs land.
  ipcMain.handle('watch-folders', (evt, paths) => {
    watchSender = evt.sender;
    if (!folderWatcher) {
      folderWatcher = createFolderWatcher((_root, files) => {
        if (watchSender && !watchSender.isDestroyed()) watchSender.send('folders-changed', files);
      });
    }
    folderWatcher.setFolders(Array.isArray(paths) ? paths : []);
  });

  // EXPERIMENTAL cloud sources: where Google Drive / iCloud have mounted their
  // synced folders on this machine. Pure filesystem detection — no cloud API, no
  // login. See electron/cloudMounts.cjs.
  ipcMain.handle('detect-cloud-mounts', () => detectCloudMounts());

  // ─── EXPERIMENTAL Google Drive (Phase 2 of cloud sources) ─────────────────
  // Reaches files that exist in the Google account but were never synced to
  // disk, which the folder-based Phase 1 cannot see. Read-only scope. The user
  // supplies their OWN OAuth client (see electron/googleAuth.cjs) and signs in
  // through their own browser — no credentials are stored in this repo and the
  // app never handles the password.
  ipcMain.handle('drive-status', () => googleAuth.getStatus());
  ipcMain.handle('drive-set-credentials', (_evt, clientId, clientSecret) =>
    googleAuth.setCredentials(clientId, clientSecret)
  );
  ipcMain.handle('drive-connect', () => googleAuth.connect());
  ipcMain.handle('drive-disconnect', () => googleAuth.disconnect());
  ipcMain.handle('drive-forget', () => googleAuth.forgetCredentials());

  // Listing walks every page; progress lets a big Drive fill the list as it goes.
  ipcMain.handle('drive-list', (evt) =>
    googleDrive.listAllMediaFiles((_page, total) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('drive-list-progress', total);
    })
  );

  // Downloads land in a real folder; the renderer then imports those paths with
  // the ORDINARY importer, so Drive tracks become plain local tracks.
  ipcMain.handle('drive-download', (evt, files) =>
    googleDrive.downloadFiles(Array.isArray(files) ? files : [], (progress) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('drive-download-progress', progress);
    })
  );

  ipcMain.handle('drive-download-dir', () => googleDrive.downloadDir());

  // `defaultPath` (optional) makes the picker OPEN INSIDE a folder — the cloud
  // tiles pass their mount root so you land in Drive/iCloud already. Omitted by
  // every other caller, which keeps the old behaviour byte-for-byte.
  ipcMain.handle('select-music-folder', async (_evt, defaultPath) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: 'Select Music Folder',
      ...(typeof defaultPath === 'string' && defaultPath ? { defaultPath } : {})
    });

    if (result.canceled) return [];

    // Same recursive scan the folder-watcher uses, so "what's a song / how a
    // folder is walked" has one definition. Overlapping selections are deduped.
    return collectAudioFiles(result.filePaths);
  });

  ipcMain.handle('select-video-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: 'Select Video Folder'
    });

    if (result.canceled) return [];

    // Recursive video scan — the video counterpart of the audio import above.
    return collectVideoFiles(result.filePaths);
  });

  ipcMain.handle('select-music-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Add Music Files',
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  // ─── Player bus relay ─────────────────────────────────────────────────────
  // Engine renderer publishes its latest state; main caches + fans it out to all
  // windows. Any window sends a command; main fans it out (the engine-side hook
  // applies it). Both are fire-and-forget `.send`, mirroring remote-push-state.
  ipcMain.on('player:publish', (_evt, snapshot) => {
    playerSnapshot = snapshot;
    broadcast('player:snapshot', snapshot);
  });
  // High-rate progress patch: merge into the cached snapshot so a late window
  // still gets coherent state from request-snapshot, then fan the small patch
  // out. This is what keeps the big `playlist` array off the ~4x/sec path.
  ipcMain.on('player:progress', (_evt, patch) => {
    if (playerSnapshot) {
      playerSnapshot = {
        ...playerSnapshot,
        progress: patch.progress,
        duration: patch.duration,
        currentIndex: patch.currentIndex,
        isPlaying: patch.isPlaying,
      };
    }
    broadcast('player:progress', patch);
  });
  ipcMain.on('player:command', (_evt, cmd) => {
    broadcast('player:command', cmd);
  });
  // A window opening late pulls the cached snapshot so it doesn't wait for the
  // next publish to render state.
  ipcMain.handle('player:request-snapshot', () => playerSnapshot);

  // ─── Visualizer stream relay ──────────────────────────────────────────────
  // Windows drawing the spectrum from IPC (no local AnalyserNode) subscribe;
  // main tells the engine whether ANY window wants frames (demand), so the
  // engine only reads/streams the analyser when something is watching. Frames
  // themselves are just fanned out.
  const vizSubscribers = new Set(); // webContents ids currently watching
  const broadcastVizDemand = () => broadcast('viz:demand', vizSubscribers.size > 0);
  ipcMain.on('viz:subscribe', (evt) => {
    const id = evt.sender.id;
    vizSubscribers.add(id);
    // Drop the subscription if the window goes away without unsubscribing, so
    // demand can't get stuck on and leave the engine streaming forever.
    evt.sender.once('destroyed', () => {
      if (vizSubscribers.delete(id)) broadcastVizDemand();
    });
    broadcastVizDemand();
  });
  ipcMain.on('viz:unsubscribe', (evt) => {
    if (vizSubscribers.delete(evt.sender.id)) broadcastVizDemand();
  });
  ipcMain.on('viz:frame', (_evt, buf) => broadcast('viz:frame', buf));

  // ─── Cross-window drag session ────────────────────────────────────────────
  // Native HTML5 drag events don't cross OS windows, so this is the only channel
  // a drag from one window can reach a drop zone in another. The source publishes
  // the dragged track id; main holds it and tells every window (so they can light
  // drop zones); a drop resolves the id from here when no dataTransfer crossed.
  // See src/utils/dragSession.ts for the resolution rule.
  let dragSession = { trackId: null };
  ipcMain.on('dnd:begin', (_evt, trackId) => {
    dragSession = { trackId: trackId || null };
    broadcast('dnd:active', dragSession.trackId);
  });
  ipcMain.on('dnd:end', () => {
    dragSession = { trackId: null };
    broadcast('dnd:active', null);
  });
  // Synchronous pull of the active drag id, for a drop handler that needs it now.
  ipcMain.handle('dnd:request', () => dragSession.trackId);

  // ─── Popped-out window lifecycle ──────────────────────────────────────────
  ipcMain.handle('window:open', (_evt, id) => openChildWindow(id));
  ipcMain.on('window:close', (_evt, id) => {
    const w = childWindows.get(id);
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.on('window:focus-self', (evt) => {
    const w = BrowserWindow.fromWebContents(evt.sender);
    if (w && !w.isDestroyed()) w.focus();
  });
  ipcMain.handle('window:request-list', () => Array.from(childWindows.keys()));
  // DOCK BACK: a popped-out window asks to return to the desktop. Tell the
  // desktop to re-open it in-document, then close this standalone window. The
  // resulting window:list broadcast clears it from the desktop's popped set, so
  // the in-document copy takes over exactly where this one left off.
  ipcMain.on('window:dock', (_evt, id) => {
    if (mainWindow && !mainWindow.isDestroyed()
        && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:dock', id);
    }
    const w = childWindows.get(id);
    if (w && !w.isDestroyed()) w.close();
  });

  // LAN remote server control. All no-ops unless the user enables it in Settings.
  ipcMain.handle('remote-start', async () => {
    try {
      return await getRemoteServer().start();
    } catch (e) {
      console.error('Remote server failed to start:', e);
      return { running: false, port: null, ip: null, url: null, error: String(e && e.message || e) };
    }
  });
  ipcMain.handle('remote-stop', async () => {
    if (remoteServer) await remoteServer.stop();
    return { running: false, port: null, ip: null, url: null };
  });
  ipcMain.handle('remote-status', () =>
    remoteServer ? remoteServer.getStatus() : { running: false, port: null, ip: null, url: null }
  );
  // Renderer pushes its library index (for the phone's "play here" list + streaming).
  ipcMain.on('remote-set-library', (_evt, entries) => {
    if (remoteServer) remoteServer.setLibrary(entries);
  });
  ipcMain.on('remote-set-videos', (_evt, entries) => {
    if (remoteServer) remoteServer.setVideoLibrary(entries);
  });
  // Renderer pushes the now-playing snapshot; forwarded to connected phones.
  ipcMain.on('remote-push-state', (_evt, state) => {
    if (remoteServer) remoteServer.pushState(state);
  });
  // Device management (from the PC's Settings only).
  ipcMain.handle('remote-devices', () => (remoteServer ? remoteServer.listDevices() : []));
  ipcMain.handle('remote-trust', (_evt, id, trusted) =>
    remoteServer ? remoteServer.setTrusted(id, trusted) : false
  );
  ipcMain.handle('remote-kick', (_evt, id) => (remoteServer ? remoteServer.kickDevice(id) : false));

  createWindow();

  // Auto-update: no-op in dev / unpackaged, checks GitHub Releases otherwise.
  initAutoUpdate(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Release all filesystem watchers so we don't leak native handles on quit.
app.on('before-quit', () => {
  if (folderWatcher) folderWatcher.closeAll();
  if (remoteServer) remoteServer.stop();
});
