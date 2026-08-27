// Reads Shoutcast/Icecast "ICY" metadata from a live radio stream so the player
// can show the current track title, station name, and a favicon. Lives in main
// because it needs a raw HTTP request with the `Icy-MetaData: 1` header and
// byte-level stream parsing — neither of which the renderer's fetch can do (the
// header is forbidden, and the response is an endless audio stream).
//
// Protocol: with `Icy-MetaData: 1` set, the server replies with an `icy-metaint`
// header = N. The body is then N bytes of audio, followed by 1 length byte L,
// followed by L*16 bytes of metadata (a "StreamTitle='...';" string, possibly
// zero-padded), repeating forever. We read exactly one metadata block, extract
// the title, and drop the connection.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const USER_AGENT = 'BrutalPlayer/1.0';
const CONNECT_TIMEOUT_MS = 8000;
// Hard ceiling so a pathological icy-metaint can't make us buffer forever.
const MAX_READ_BYTES = 1_000_000;

// GET with a couple of manual redirect hops (stream URLs commonly 302 to a node).
function openStream(rawUrl, redirectsLeft, cb) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return cb(new Error('Invalid URL'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return cb(new Error('Unsupported protocol'));
  }

  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.request(
    url,
    {
      method: 'GET',
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        Connection: 'close',
      },
    },
    (res) => {
      const { statusCode, headers } = res;
      if (
        [301, 302, 303, 307, 308].includes(statusCode) &&
        headers.location &&
        redirectsLeft > 0
      ) {
        res.destroy();
        let next;
        try {
          next = new URL(headers.location, url).toString();
        } catch {
          return cb(new Error('Bad redirect'));
        }
        return openStream(next, redirectsLeft - 1, cb);
      }
      if (statusCode !== 200) {
        res.destroy();
        return cb(new Error('HTTP ' + statusCode));
      }
      cb(null, res, url);
    }
  );

  req.on('error', cb);
  req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('Timeout')));
  req.end();
}

/**
 * Resolve to `{ title, name, homepage, favicon }` for a live stream URL, or
 * `null` if the stream can't be reached. `title` is the current-track string
 * (null when the stream sends no in-band metadata); `name`/`homepage` come from
 * the icy-* headers; `favicon` is a best-effort /favicon.ico on the station's
 * homepage (or the stream host) for the desktop tile.
 */
function fetchIcyNowPlaying(rawUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openStream(rawUrl, 3, (err, res, finalUrl) => {
      if (err || !res) return finish(null);

      const name = res.headers['icy-name'] || null;
      const homepage = res.headers['icy-url'] || null;
      let favicon = null;
      try {
        const base = homepage && /^https?:/i.test(homepage) ? homepage : finalUrl.origin;
        favicon = new URL('/favicon.ico', base).toString();
      } catch {
        /* leave favicon null */
      }

      const base = { title: null, name, homepage, favicon };

      const metaint = parseInt(res.headers['icy-metaint'], 10);
      if (!metaint || Number.isNaN(metaint)) {
        // Server sent no in-band metadata channel; headers are all we get.
        res.destroy();
        return finish(base);
      }

      // Safety net: if the metadata block never arrives, return the headers.
      const guard = setTimeout(() => {
        res.destroy();
        finish(base);
      }, CONNECT_TIMEOUT_MS);

      let buffer = Buffer.alloc(0);
      let read = 0;
      let phase = 'audio'; // audio -> len -> meta
      let needed = metaint;
      let metaLen = 0;

      res.on('data', (chunk) => {
        read += chunk.length;
        buffer = Buffer.concat([buffer, chunk]);
        if (read > MAX_READ_BYTES) {
          clearTimeout(guard);
          res.destroy();
          return finish(base);
        }
        // Walk the state machine as far as the buffered bytes allow.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (phase === 'audio') {
            if (buffer.length < needed) return;
            buffer = buffer.subarray(needed);
            phase = 'len';
          }
          if (phase === 'len') {
            if (buffer.length < 1) return;
            metaLen = buffer[0] * 16;
            buffer = buffer.subarray(1);
            if (metaLen === 0) {
              // Empty metadata this cycle — skip another audio block and retry.
              phase = 'audio';
              needed = metaint;
              continue;
            }
            phase = 'meta';
          }
          if (phase === 'meta') {
            if (buffer.length < metaLen) return;
            const block = buffer.subarray(0, metaLen).toString('utf8');
            const m = /StreamTitle='([^']*)'/.exec(block);
            clearTimeout(guard);
            res.destroy();
            return finish({ ...base, title: m ? m[1].trim() || null : null });
          }
        }
      });
      res.on('error', () => {
        clearTimeout(guard);
        finish(base);
      });
      res.on('end', () => {
        clearTimeout(guard);
        finish(base);
      });
    });
  });
}

module.exports = { fetchIcyNowPlaying };
