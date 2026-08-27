// The local-media:// protocol handler, extracted from main.cjs so it can be
// exercised by a test harness against a real Chromium media loader without
// booting the whole app.
//
// Serving media over a custom protocol is not just "return the bytes". A media
// element seeks by issuing repeated Range requests, and Chromium's loader will
// refuse to seek unless every response carries a correct 206 status, a
// Content-Range, and strong validators (ETag / Last-Modified) proving the
// ranges refer to one unchanging resource.
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const { pathToFileURL } = require('url');

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/x-flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
};

/** Turn a local-media:// request URL into an on-disk path. */
function pathFromRequest(request) {
  const url = new URL(request.url);
  let filePath = decodeURIComponent(url.pathname);

  // On Windows the pathname arrives with a leading slash (/C:/...).
  if (process.platform === 'win32' && filePath.startsWith('/') && (filePath[2] === ':' || filePath[1] === ':')) {
    filePath = filePath.slice(1);
  }
  if (process.platform === 'win32') {
    filePath = filePath.replace(/\//g, '\\');
  }
  return filePath;
}

/**
 * Parse a Range header against a known size.
 * Returns null for "no range", or { start, end }, or { unsatisfiable: true }.
 */
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  let start = match && match[1] !== '' ? parseInt(match[1], 10) : NaN;
  let end = match && match[2] !== '' ? parseInt(match[2], 10) : NaN;

  if (isNaN(start) && isNaN(end)) {
    start = 0;
    end = size - 1;
  } else if (isNaN(start)) {
    start = Math.max(0, size - end); // suffix range: last N bytes
    end = size - 1;
  } else if (isNaN(end)) {
    end = size - 1;
  }
  end = Math.min(end, size - 1);

  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end };
}

/**
 * Build the protocol.handle callback.
 *
 * @param {object} deps
 * @param {(rawPath: string) => string|null} deps.resolveExistingPath
 * @param {(...args: any[]) => void} [deps.log]
 */
function createLocalMediaHandler({ resolveExistingPath, log = console.error }) {
  return async function handleLocalMedia(request) {
    try {
      const resolved = resolveExistingPath(pathFromRequest(request));
      if (!resolved) {
        log('local-media: file not found:', pathFromRequest(request));
        return new Response('File not found', { status: 404 });
      }

      const contentType = MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
      const stat = fs.statSync(resolved);

      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Access-Control-Allow-Origin', '*');
      // Strong validators: the media loader needs these to trust that multiple
      // range requests (i.e. seeking) refer to the same resource.
      headers.set('ETag', `"${stat.size}-${Math.floor(stat.mtimeMs)}"`);
      headers.set('Last-Modified', stat.mtime.toUTCString());

      const range = parseRange(request.headers.get('Range'), stat.size);

      if (range && range.unsatisfiable) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      }

      // Serve via Chromium's own file loader: net.fetch on a file:// URL slices
      // ranges byte-accurately and handles aborts natively, which hand-rolled fs
      // streams do not. But it reports 200 with no Content-Range, so rebuild the
      // 206 headers ourselves.
      const fileUrl = pathToFileURL(resolved).toString();

      if (range) {
        const response = await net.fetch(fileUrl, {
          headers: { Range: `bytes=${range.start}-${range.end}` },
        });
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
        headers.set('Content-Length', String(range.end - range.start + 1));
        return new Response(response.body, { status: 206, headers });
      }

      const response = await net.fetch(fileUrl);
      headers.set('Content-Length', String(stat.size));
      return new Response(response.body, { status: 200, headers });
    } catch (error) {
      log('Local media protocol error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  };
}

module.exports = { createLocalMediaHandler, parseRange, MIME_TYPES };
