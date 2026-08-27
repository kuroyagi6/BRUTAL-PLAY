// Google OAuth for the EXPERIMENTAL Drive layer (Phase 2 of the cloud sources).
//
// Phase 1 (electron/cloudMounts.cjs) reads Drive's already-synced folder and
// needs no login at all. This file exists only for what that CANNOT do: reach
// files that live in the Google account but were never downloaded to disk
// (Drive's streaming mode shows names without bytes).
//
// ─── Design notes that are easy to get wrong ─────────────────────────────────
//
// 1. THE SYSTEM BROWSER, NOT A BrowserWindow. Google blocks OAuth inside
//    embedded webviews (error: 'disallowed_useragent'), so the consent page is
//    opened with shell.openExternal and the user signs in to Google directly, in
//    their own browser. The app never sees the password — it only ever receives
//    the redirect code. Do NOT "improve" this by embedding the login page.
//
// 2. LOOPBACK REDIRECT + PKCE (RFC 8252, the installed-app flow). We listen on
//    127.0.0.1 on an OS-assigned port and use that as redirect_uri. PKCE binds
//    the code to this process, so a code intercepted on the loopback can't be
//    redeemed by anything else.
//
// 3. THE CLIENT SECRET IS THE USER'S, AND IS NOT IN THE REPO. Desktop OAuth
//    clients are not confidential (RFC 8252 §8.5) — a shipped secret would be
//    extractable anyway — so instead of hardcoding one, the user pastes their own
//    client id/secret from their own Google Cloud project. It is stored encrypted
//    with Electron safeStorage (DPAPI on Windows / Keychain on macOS), same as
//    the refresh token. Nothing sensitive is ever written in plaintext.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, shell, safeStorage } = require('electron');

// Read-only across the user's Drive. 'drive.file' would be narrower but only
// exposes files this app itself created, which cannot browse an existing music
// library — the entire point here. We never request a write scope.
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

// How long to wait for the user to finish signing in before giving up.
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
// Refresh a little early so a long download never dies mid-flight on a 401.
const TOKEN_EARLY_REFRESH_MS = 60 * 1000;

const STORE_FILE = 'google-drive-auth.bin';

/** In-memory access token: { token, expiresAt }. Never persisted. */
let accessToken = null;

const storePath = () => path.join(app.getPath('userData'), STORE_FILE);

// ─── Encrypted store ─────────────────────────────────────────────────────────
// Holds { clientId, clientSecret, refreshToken, email }. safeStorage hands the
// key to the OS keychain, so this file is useless if copied to another machine.

function readStore() {
  try {
    const buf = fs.readFileSync(storePath());
    if (!safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    // Missing, corrupt, or encrypted under a different OS profile — all mean
    // "not set up", which is a normal state rather than an error.
    return {};
  }
}

function writeStore(data) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage unavailable — refusing to store credentials in plaintext');
  }
  fs.writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(data)));
}

function clearStore() {
  try {
    fs.unlinkSync(storePath());
  } catch {
    /* already gone */
  }
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ─── Loopback listener ───────────────────────────────────────────────────────

/**
 * Listen on 127.0.0.1 for Google's redirect.
 *
 * Returns { portPromise, codePromise }: the port is needed to BUILD the auth URL
 * (it's part of redirect_uri), so it has to be available well before the code
 * arrives — hence two promises rather than one.
 *
 * `state` is checked so a stray request to this port can't inject a code.
 */
function startLoopback(state) {
  let resolvePort;
  const portPromise = new Promise((r) => {
    resolvePort = r;
  });

  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }

      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      const gotState = url.searchParams.get('state');

      // Tell the user in their browser, since the app can't focus it for them.
      const reply = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>BRUTAL PLAYER</title>` +
            `<body style="background:#0a0a0a;color:#eee;font:14px ui-monospace,monospace;display:flex;` +
            `align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">` +
            `<div><h1 style="letter-spacing:.1em">BRUTAL PLAYER</h1><p>${msg}</p></div>`
        );
      };

      if (err) {
        reply('AUTHORIZATION_DENIED — you can close this tab.');
        cleanup();
        reject(new Error(`Google returned: ${err}`));
        return;
      }
      if (!code || gotState !== state) {
        reply('UNEXPECTED_RESPONSE — you can close this tab.');
        return; // keep listening; this wasn't our redirect
      }

      reply('CONNECTED — you can close this tab and return to the app.');
      cleanup();
      resolve(code);
    });

    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      server.close();
    };

    server.on('error', (e) => {
      cleanup();
      reject(e);
    });

    // Port 0 = let the OS pick a free one. Google permits any loopback port.
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for Google sign-in'));
      }, CONSENT_TIMEOUT_MS);
      resolvePort(server.address().port);
    });
  });

  return { portPromise, codePromise };
}

// ─── Token exchange ──────────────────────────────────────────────────────────

async function postForm(endpoint, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    // Google's error_description is genuinely useful (bad secret, wrong client
    // type, redirect mismatch), so surface it instead of a bare status.
    throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
  }
  return json;
}

/** Exchange a refresh token for a fresh access token, caching it in memory. */
async function refreshAccessToken() {
  const { clientId, clientSecret, refreshToken } = readStore();
  if (!clientId || !refreshToken) throw new Error('Not connected to Google Drive');

  const json = await postForm(TOKEN_ENDPOINT, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  accessToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return accessToken.token;
}

/** A valid access token, refreshing when missing or close to expiry. */
async function getAccessToken() {
  if (accessToken && accessToken.expiresAt - TOKEN_EARLY_REFRESH_MS > Date.now()) {
    return accessToken.token;
  }
  return refreshAccessToken();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Save the user's own OAuth client. Clears any existing session. */
function setCredentials(clientId, clientSecret) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id) throw new Error('Client ID is required');
  // Changing the client invalidates tokens issued by the old one.
  writeStore({ clientId: id, clientSecret: secret });
  accessToken = null;
  return getStatus();
}

function getStatus() {
  const { clientId, refreshToken, email, grantedScope } = readStore();
  return {
    /** Has the user pasted a Google Cloud OAuth client yet? */
    configured: !!clientId,
    /** Is there a usable refresh token? */
    connected: !!refreshToken,
    email: email ?? null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    /**
     * The scopes Google ACTUALLY granted, straight from the token response —
     * not the ones we asked for. These differ whenever a restricted scope is
     * missing from the consent screen's Data Access list: consent succeeds, the
     * scope is silently dropped, and Drive then answers 403 "insufficient
     * authentication scopes". Surfacing it turns that into a one-look diagnosis.
     */
    grantedScope: grantedScope ?? null,
    /** Convenience for the UI: did we get the one scope that matters? */
    hasDriveScope: typeof grantedScope === 'string' && grantedScope.includes(SCOPE),
  };
}

/**
 * Run the full consent flow. Opens the user's real browser; resolves once they
 * have signed in and Google has redirected back to our loopback listener.
 */
async function connect() {
  const { clientId, clientSecret } = readStore();
  if (!clientId) throw new Error('Add your Google OAuth client ID first');

  const state = base64url(crypto.randomBytes(16));
  const { verifier, challenge } = makePkce();
  const { portPromise, codePromise } = startLoopback(state);
  const port = await portPromise;
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl =
    `${AUTH_ENDPOINT}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: `${SCOPE} email`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      // 'offline' is what makes Google issue a refresh token; 'consent' forces
      // it to be re-issued even if the user has approved this client before
      // (otherwise a re-connect silently yields no refresh token at all).
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  await shell.openExternal(authUrl);
  const code = await codePromise;

  const json = await postForm(TOKEN_ENDPOINT, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  accessToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };

  // Which account did they pick? Nice to show, and confirms the token works.
  let email = null;
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${json.access_token}` },
    });
    if (res.ok) email = (await res.json()).email ?? null;
  } catch {
    /* cosmetic only */
  }

  if (!json.refresh_token) {
    throw new Error('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and try again');
  }

  // Record what Google actually granted (json.scope), so a silently-dropped
  // restricted scope is visible in the UI instead of only surfacing later as an
  // opaque 403 from the Drive API.
  writeStore({
    clientId,
    clientSecret,
    refreshToken: json.refresh_token,
    email,
    grantedScope: json.scope ?? null,
  });
  return getStatus();
}

/** Revoke at Google (best effort) and wipe the local session. */
async function disconnect() {
  const { refreshToken, clientId, clientSecret } = readStore();
  if (refreshToken) {
    try {
      await postForm(REVOKE_ENDPOINT, { token: refreshToken });
    } catch {
      // Already revoked or offline — the local wipe below still matters.
    }
  }
  accessToken = null;
  // Keep the client id/secret so the user doesn't have to paste it again.
  if (clientId) writeStore({ clientId, clientSecret });
  else clearStore();
  return getStatus();
}

/** Forget everything, including the OAuth client. */
async function forgetCredentials() {
  await disconnect().catch(() => {});
  clearStore();
  accessToken = null;
  return getStatus();
}

module.exports = {
  setCredentials,
  getStatus,
  connect,
  disconnect,
  forgetCredentials,
  getAccessToken,
  SCOPE,
};
