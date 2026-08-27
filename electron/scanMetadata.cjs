// Main-process metadata scanning for import.
//
// Parsing here rather than in the renderer is what makes a 250-song folder
// import quick: parseFile tokenizes the tag bytes straight off disk, so we skip
// a fetch through the local-media protocol (and its stat + stream setup) for
// every single file. Files are parsed by a small async pool instead of one at a
// time. Mirrors src/audio/trackMetadata.ts `extract` — keep the two in step.
const os = require('os');
const crypto = require('crypto');
const mm = require('music-metadata');

/** Tag extraction for a single already-parsed file. Cover art comes back as raw
 *  bytes because a Blob can't cross the IPC boundary. */
function extract(nativePath, metadata) {
  const { common, format, native } = metadata;

  const meta = {
    path: nativePath,
    title: common.title || undefined,
    artist: common.artist || undefined,
    album: common.album || undefined,
    genre: common.genre && common.genre.length > 0 ? common.genre.join(', ') : undefined,
    bitrate: format.bitrate,
    sampleRate: format.sampleRate,
    codec: format.codec,
    duration: format.duration,
  };

  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0];
    // Hash here, where the bytes already live. Every track on an album embeds
    // the same artwork, so the renderer keys covers by hash and stores one copy.
    meta.cover = {
      data: new Uint8Array(pic.data), // Buffer structured-clones to a Uint8Array
      format: pic.format,
      hash: crypto.createHash('sha256').update(pic.data).digest('hex'),
    };
  }

  if (common.lyrics && common.lyrics.length > 0) meta.lyrics = common.lyrics[0];

  // SYLT = synced lyrics, stored in format-specific native tags.
  for (const tagFormat in native) {
    const tags = native[tagFormat];
    if (!Array.isArray(tags)) continue;
    const sylt = tags.find((t) => t.id === 'SYLT');
    if (sylt && sylt.value && Array.isArray(sylt.value.syncText)) {
      meta.syncedLyrics = sylt.value.syncText.map((s) => ({
        text: s.text || '',
        timestamp: s.timestamp / 1000,
      }));
      break;
    }
  }

  return meta;
}

/**
 * Parse tags for many files concurrently.
 *
 * @param paths       native file paths
 * @param resolvePath maps a stored path to one that exists on disk
 * @param onProgress  called as files complete, already throttled
 * @returns one entry per input path, in order; entries with `.error` failed to
 *          parse and the caller should fall back to the filename.
 */
async function scanMetadata(paths, resolvePath, onProgress) {
  if (!Array.isArray(paths) || paths.length === 0) return [];

  const results = new Array(paths.length);
  let next = 0;
  let done = 0;
  let lastSent = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= paths.length) return;
      const p = paths[i];
      try {
        // Default options (no `duration: true`) keep this a header-only read;
        // duration still comes from Xing/VBRI or the bitrate+size estimate,
        // matching what the old renderer-side parse produced.
        results[i] = extract(p, await mm.parseFile(resolvePath(p) || p));
      } catch (error) {
        // A tag we can't read must not sink the import.
        results[i] = { path: p, error: String((error && error.message) || error) };
      }
      done++;
      // Throttle: 253 IPC sends would cost more than the parse.
      if (done === paths.length || done - lastSent >= 5) {
        lastSent = done;
        if (onProgress) onProgress({ done, total: paths.length });
      }
    }
  };

  const concurrency = Math.max(4, Math.min(16, os.cpus().length));
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return results;
}

module.exports = { scanMetadata, extract };
