// Opt-in LAN remote server (main process). OFF by default; started only when the
// user enables it in Settings. It lets a phone on the same network (e.g. the PC
// tethered to the phone's hotspot) both CONTROL the PC's playback and STREAM a
// song to play on the phone itself.
//
// Contained on purpose: it owns no audio state. The renderer pushes state in
// (pushState), sends its library index in (setLibrary), and receives commands
// out (onCommand). Everything audio still lives in the React engine — see
// src/remote/useRemoteServer.ts. Wire format is src/remote/remoteProtocol.ts.
//
// Access model (two tiers):
//   PIN   — a 4-digit PIN (via /auth) mints a per-device cookie token. Required
//           for everything but the page shell + /auth. The QR embeds ?pin= so a
//           scan authenticates in one step.
//   TRUST — a token alone lets a device VIEW now-playing + browse + play songs on
//           its OWN phone, but NOT control the PC. POST /command additionally
//           requires the device to be marked trusted (done from the PC in
//           Settings). So a freshly-scanned phone is view-only until approved.
// The PC can list devices, toggle trust, and kick (revoke) — all via the object
// API below, never over HTTP, so a phone can't manage other phones. Devices are
// persisted (deps.loadDevices/saveDevices) so trust survives an app restart.
//
// Transport: SSE (GET /events) for state; POST for commands; a hand-rolled Range
// handler for /stream so the phone's <audio> can seek. Cover art via
// music-metadata, cached. Binds 0.0.0.0 so the hotspot peer can reach it.

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const mm = require('music-metadata');
const QRCode = require('qrcode');
const { parseRange, MIME_TYPES } = require('./localMediaProtocol.cjs');
const { PAGE } = require('./remotePage.cjs');

const PORT_CANDIDATES = [8080, 8090, 8100, 8422];
const ART_CACHE_MAX = 60;

/** First non-internal IPv4 address (what the phone connects to). */
function lanAddress() {
  const ifaces = os.networkInterfaces();
  const prefer = [];
  const rest = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      // 192.168.* / 172.* / 10.* are LAN/hotspot ranges — prefer those.
      if (/^(192\.168\.|10\.|172\.)/.test(net.address)) prefer.push(net.address);
      else rest.push(net.address);
    }
  }
  return prefer[0] || rest[0] || '127.0.0.1';
}

/** Parse the Cookie header into a plain object. */
function readCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** A friendly device label from a User-Agent (order matters: Edge/Chrome/Safari). */
function deviceName(ua) {
  ua = ua || '';
  const plat = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /FxiOS|Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari'
    : 'Browser';
  return `${plat} · ${br}`;
}

function clientIp(req) {
  return String(req.socket.remoteAddress || '').replace('::ffff:', '') || '?';
}

function createRemoteServer({ resolveExistingPath, pin: providedPin, loadDevices, saveDevices, log = console.error }) {
  /** id -> { id,name,artist,album,duration,nativePath } */
  let library = new Map();
  /** id -> { id,name,duration,ext,nativePath } — parallel video index (LAN video). */
  let videoLibrary = new Map();
  let lastState = null;
  let server = null;
  let boundPort = null;
  let qrDataUrl = null;
  const sseClients = new Set(); // each res is tagged res.__token
  let commandHandler = null;

  // 4-digit PIN. main passes a persisted one so it survives app restarts; if it
  // doesn't (or in a test), generate an ephemeral one.
  const pin = /^\d{4}$/.test(String(providedPin)) ? String(providedPin) : String(crypto.randomInt(1000, 10000));

  // Device registry, keyed by cookie token. Persisted so trust survives restart:
  // the phone keeps its cookie, and we reload the matching record on boot.
  // Device = { id, token, name, ip, firstSeen, lastSeen, trusted }
  const devices = new Map();
  try {
    for (const d of (loadDevices && loadDevices()) || []) {
      if (d && d.token && d.id) devices.set(d.token, { lastSeen: d.firstSeen, ...d, trusted: !!d.trusted });
    }
  } catch (e) { log('loadDevices failed:', e); }

  const persist = () => {
    try { saveDevices && saveDevices([...devices.values()]); } catch (e) { log('saveDevices failed:', e); }
  };

  // trackId -> { mime, buf } cover cache (FIFO-capped).
  const artCache = new Map();

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  // LAN-only tool; a permissive CORS header keeps the phone browser happy.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // The page shell is always served — it contains the PIN login UI itself.
  app.get('/', (_req, res) => res.type('html').send(PAGE));

  // Exchange the PIN for a cookie token + a new (untrusted) device record.
  app.post('/auth', (req, res) => {
    if (!req.body || String(req.body.pin) !== pin) return res.status(403).json({ error: 'bad pin' });
    const token = crypto.randomBytes(18).toString('hex');
    const now = Date.now();
    devices.set(token, {
      id: crypto.randomBytes(4).toString('hex'),
      token,
      name: deviceName(req.headers['user-agent']),
      ip: clientIp(req),
      firstSeen: now,
      lastSeen: now,
      trusted: false,
    });
    persist();
    res.set('Set-Cookie', `bt=${token}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`);
    res.json({ ok: true, trusted: false });
  });

  // Any valid token → sets req.device.
  const requireAuth = (req, res, next) => {
    const dev = devices.get(readCookies(req).bt);
    if (!dev) return res.status(401).json({ error: 'auth required' });
    dev.lastSeen = Date.now();
    req.device = dev;
    next();
  };
  // Control endpoints additionally require the device to be trusted.
  const requireTrust = (req, res, next) => {
    if (req.device && req.device.trusted) return next();
    return res.status(403).json({ error: 'untrusted' });
  };

  // PC -> phone state stream.
  app.get('/events', requireAuth, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
    res.__token = req.device.token;
    sseClients.add(res);
    if (lastState) res.write(`data: ${JSON.stringify(lastState)}\n\n`);
    // Comment ping keeps intermediaries from closing an idle connection.
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  });

  // phone -> PC command. Requires TRUST (not just a valid PIN token).
  app.post('/command', requireAuth, requireTrust, (req, res) => {
    if (commandHandler) {
      try { commandHandler(req.body); } catch (e) { log('remote command failed:', e); }
    }
    res.sendStatus(204);
  });

  // Safe subset of the library for the phone's "play here" list (no disk paths).
  app.get('/library', requireAuth, (_req, res) => {
    const list = [];
    for (const t of library.values()) {
      list.push({ id: t.id, name: t.name, artist: t.artist, album: t.album, duration: t.duration });
    }
    res.json(list);
  });

  // Embedded cover art for a track, extracted from its tags on demand + cached.
  app.get('/art/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    const cached = artCache.get(id);
    if (cached) {
      res.set('Content-Type', cached.mime).set('Cache-Control', 'max-age=3600');
      return res.end(cached.buf);
    }
    const entry = library.get(id);
    if (!entry || !entry.nativePath) return res.status(404).end();
    const resolved = resolveExistingPath(entry.nativePath);
    if (!resolved) return res.status(404).end();
    try {
      const meta = await mm.parseFile(resolved);
      const pic = meta.common.picture && meta.common.picture[0];
      if (!pic) return res.status(404).end();
      const rec = { mime: pic.format || 'image/jpeg', buf: Buffer.from(pic.data) };
      artCache.set(id, rec);
      if (artCache.size > ART_CACHE_MAX) artCache.delete(artCache.keys().next().value);
      res.set('Content-Type', rec.mime).set('Cache-Control', 'max-age=3600');
      res.end(rec.buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  // Range-stream a file on disk to the phone so its <audio>/<video> can seek.
  // Shared by /stream (audio) and /vstream (video) — same 206 machinery, only
  // the source index differs.
  function streamFromIndex(index, req, res) {
    const entry = index.get(req.params.id);
    if (!entry || !entry.nativePath) return res.status(404).end('unknown id');
    const resolved = resolveExistingPath(entry.nativePath);
    if (!resolved) return res.status(404).end('file not found');

    let stat;
    try { stat = fs.statSync(resolved); } catch (e) { return res.status(404).end('file not found'); }

    const type = MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Type', type);

    const range = parseRange(req.headers.range, stat.size);
    if (range && range.unsatisfiable) {
      res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    if (range) {
      res.status(206);
      res.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      res.set('Content-Length', String(range.end - range.start + 1));
      fs.createReadStream(resolved, { start: range.start, end: range.end })
        .on('error', () => res.end())
        .pipe(res);
    } else {
      res.set('Content-Length', String(stat.size));
      fs.createReadStream(resolved).on('error', () => res.end()).pipe(res);
    }
  }

  // Stream a track by id to the phone with Range support (so it can seek).
  app.get('/stream/:id', requireAuth, (req, res) => streamFromIndex(library, req, res));

  // Safe subset of the video library for the phone's VIDEO tab (no disk paths).
  app.get('/videos', requireAuth, (_req, res) => {
    const list = [];
    for (const v of videoLibrary.values()) {
      list.push({ id: v.id, name: v.name, duration: v.duration, ext: v.ext });
    }
    res.json(list);
  });

  // Stream a video by id (same Range streamer; mp4/webm play in mobile browsers).
  app.get('/vstream/:id', requireAuth, (req, res) => streamFromIndex(videoLibrary, req, res));

  function tryListen(ports) {
    return new Promise((resolve, reject) => {
      const [port, ...rest] = ports;
      if (port == null) return reject(new Error('no free port'));
      const s = app.listen(port, '0.0.0.0');
      s.once('listening', () => resolve({ server: s, port }));
      s.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && rest.length) resolve(tryListen(rest));
        else reject(err);
      });
    });
  }

  const isConnected = (token) => {
    for (const res of sseClients) if (res.__token === token) return true;
    return false;
  };

  return {
    async start() {
      if (server) return this.getStatus();
      const r = await tryListen(PORT_CANDIDATES);
      server = r.server;
      boundPort = r.port;
      try {
        const ip = lanAddress();
        const authUrl = `http://${ip}:${boundPort}/?pin=${pin}`;
        qrDataUrl = await QRCode.toDataURL(authUrl, { margin: 1, width: 260 });
      } catch (e) {
        qrDataUrl = null;
        log('QR generation failed:', e);
      }
      return this.getStatus();
    },
    async stop() {
      for (const res of sseClients) { try { res.end(); } catch (_) { /* ignore */ } }
      sseClients.clear();
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
        server = null;
        boundPort = null;
        qrDataUrl = null;
      }
    },
    getStatus() {
      const ip = lanAddress();
      return {
        running: !!server,
        port: boundPort,
        ip,
        url: boundPort ? `http://${ip}:${boundPort}` : null,
        pin,
        qr: qrDataUrl,
      };
    },
    // Device management — called from the PC (via IPC), never exposed over HTTP.
    listDevices() {
      return [...devices.values()]
        .map((d) => ({
          id: d.id, name: d.name, ip: d.ip,
          firstSeen: d.firstSeen, lastSeen: d.lastSeen,
          trusted: d.trusted, connected: isConnected(d.token),
        }))
        .sort((a, b) => b.lastSeen - a.lastSeen);
    },
    setTrusted(id, trusted) {
      for (const d of devices.values()) {
        if (d.id === id) { d.trusted = !!trusted; persist(); return true; }
      }
      return false;
    },
    kickDevice(id) {
      for (const [token, d] of devices) {
        if (d.id !== id) continue;
        devices.delete(token);
        for (const res of [...sseClients]) {
          if (res.__token === token) { try { res.end(); } catch (_) { /* ignore */ } sseClients.delete(res); }
        }
        persist();
        return true;
      }
      return false;
    },
    setLibrary(entries) {
      const next = new Map();
      for (const e of entries || []) if (e && e.id) next.set(e.id, e);
      library = next;
    },
    setVideoLibrary(entries) {
      const next = new Map();
      for (const e of entries || []) if (e && e.id) next.set(e.id, e);
      videoLibrary = next;
    },
    pushState(state) {
      lastState = state;
      const line = `data: ${JSON.stringify(state)}\n\n`;
      for (const res of sseClients) { try { res.write(line); } catch (_) { /* dropped */ } }
    },
    onCommand(cb) { commandHandler = cb; },
  };
}

module.exports = { createRemoteServer, lanAddress, deviceName };
