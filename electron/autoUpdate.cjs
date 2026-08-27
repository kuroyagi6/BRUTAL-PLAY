// ─── Auto-update layer ──────────────────────────────────────────────────────
// A fully self-contained wrapper around electron-updater. The ONLY coupling to
// the rest of the app is initAutoUpdate(getWindow), called once from main after
// the window exists. It is a hard no-op in development and when the app isn't
// packaged, so `npm run electron:dev` behaves exactly as before.
//
// How updates flow (GitHub Releases provider, configured in electron-builder.yml):
//   app launches → checks the latest GitHub Release → if newer, downloads it in
//   the background → installs on the next quit (or immediately if the renderer
//   asks via the 'update:install' channel). Status is forwarded to every window
//   on 'update:status' purely so a UI can show it; playback is never affected.

const { app, ipcMain, BrowserWindow } = require('electron');

let wired = false;

function broadcastStatus(payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    const wc = !w.isDestroyed() && w.webContents;
    if (wc && !wc.isDestroyed()) {
      try { wc.send('update:status', payload); } catch { /* window gone */ }
    }
  }
}

// getWindow is unused today (status is broadcast to all windows) but kept in the
// signature so a caller can pass the main window without a later change.
function initAutoUpdate(_getWindow) {
  // Dev / unpackaged: never touch the network or the filesystem.
  if (!app.isPackaged || process.env.NODE_ENV === 'development') return;
  if (wired) return;
  wired = true;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    // Dependency not installed yet — packaging will include it. Fail silently so
    // a mis-built package still launches and plays music.
    console.error('electron-updater not available:', e && e.message);
    return;
  }

  autoUpdater.autoDownload = true;          // fetch in the background when found
  autoUpdater.autoInstallOnAppQuit = true;  // apply on next quit, no prompt

  autoUpdater.on('checking-for-update', () => broadcastStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcastStatus({ state: 'available', version: info && info.version }));
  autoUpdater.on('update-not-available', () => broadcastStatus({ state: 'current' }));
  autoUpdater.on('download-progress', (p) =>
    broadcastStatus({ state: 'downloading', percent: p && Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) =>
    broadcastStatus({ state: 'ready', version: info && info.version }));
  autoUpdater.on('error', (err) =>
    broadcastStatus({ state: 'error', message: String(err && err.message || err) }));

  // Renderer can ask to restart-and-install now instead of waiting for quit.
  ipcMain.handle('update:install', () => {
    try { autoUpdater.quitAndInstall(); } catch (e) { console.error('quitAndInstall failed:', e); }
  });
  // Renderer can trigger a manual re-check (e.g. a "check for updates" button).
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => {}));

  // Kick off the first check shortly after launch so it never competes with the
  // window's first paint / library load.
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4000);
}

module.exports = { initAutoUpdate };
