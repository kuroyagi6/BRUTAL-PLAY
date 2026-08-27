// Allowlisted, throttled JSON fetcher for the online lookup features (artist
// profiles, artist photos, synced lyrics). Lives in main because these APIs
// reject or discourage requests without a descriptive User-Agent — a header the
// renderer is forbidden to set — and because MusicBrainz enforces a hard ~1
// request/second limit. The renderer reaches this through the `http-get-json`
// IPC channel; it can only ever hit the hosts below.

// Keep in sync with ALLOWED_HOSTS in src/services/artistProfile.ts.
//
// `gapMs` is the minimum spacing between requests TO THAT HOST, and each host
// gets its OWN queue. That per-host split matters: MusicBrainz's 1.1s leash used
// to be applied globally, so a library-wide artist-photo prefetch would have sat
// in front of every lyrics lookup and made the Lyrics button feel broken for
// minutes. Deezer and LRCLIB are unrelated services and shouldn't wait on it.
const HOSTS = {
  // MusicBrainz asks for <=1 req/sec, and enforces it with 503s.
  'musicbrainz.org': { gapMs: 1100 },
  // Wikimedia is happy with far more than we send; stay polite anyway.
  'en.wikipedia.org': { gapMs: 100 },
  'www.wikidata.org': { gapMs: 100 },
  // Deezer's documented ceiling is 50 requests / 5s -> 100ms. Keep a margin.
  'api.deezer.com': { gapMs: 120 },
  // LRCLIB publishes no hard limit; this is politeness for a free service.
  'lrclib.net': { gapMs: 200 },
  // Apple documents "approximately 20 calls per minute" for the Search API and
  // answers 403 past it. 3.1s keeps us just under 20/min. It is the RADAR track
  // source because Deezer serves no track payloads in every region (its /top,
  // /albums and track search all return data:[] with a non-zero total), while
  // iTunes has no such restriction.
  'itunes.apple.com': { gapMs: 3100 },
  // Genius, for lyric ANNOTATIONS only (the MEANING corner) — never lyric text,
  // which its API doesn't serve. The only host here needing credentials: the
  // renderer passes the user's own Client Access Token per call and it is
  // attached as a bearer header. `auth` gates that: a token offered for any
  // other host is ignored, so a stray token can't leak to MusicBrainz et al.
  // Genius documents
  // no public rate limit; 250ms is politeness.
  'api.genius.com': { gapMs: 250, auth: 'bearer' },
};

const ALLOWED_HOSTS = new Set(Object.keys(HOSTS));

// A polite, identifying User-Agent is required by the MusicBrainz API terms and
// requested by LRCLIB.
const USER_AGENT = 'BrutalPlayer/1.0 (https://github.com/brutal-player)';

const DEFAULT_GAP_MS = 1100;
const TIMEOUT_MS = 8000;

/** host -> { chain, lastAt }. One independent queue per host. */
const queues = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialize lookups PER HOST and space them out to that host's rate limit. */
async function throttle(host) {
  let q = queues.get(host);
  if (!q) {
    q = { chain: Promise.resolve(), lastAt: 0 };
    queues.set(host, q);
  }
  const gap = (HOSTS[host] || {}).gapMs ?? DEFAULT_GAP_MS;

  const run = q.chain.then(async () => {
    const wait = q.lastAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
  });
  // Swallow rejections on the shared chain so one failure doesn't poison the next.
  q.chain = run.catch(() => {});
  await run;
}

/**
 * Fetch and parse JSON from an allowlisted host. Throws on a disallowed host, a
 * non-OK response, or a network error. The timeout keeps a hung request from
 * blocking that host's throttle chain forever.
 *
 * The thrown message carries the status ("HTTP 404") because callers depend on
 * it: lyricsFetch treats a 404 from LRCLIB's exact endpoint as "try the search"
 * rather than as a failure.
 *
 * `opts.bearer` is honoured ONLY by hosts marked `auth: 'bearer'` above, and
 * such a host refuses to be called without one.
 */
async function httpGetJson(rawUrl, opts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('Host not allowed: ' + url.hostname);
  }

  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (HOSTS[url.hostname].auth === 'bearer') {
    const token = opts && typeof opts.bearer === 'string' ? opts.bearer.trim() : '';
    if (!token) throw new Error('Missing token for ' + url.hostname);
    headers.Authorization = 'Bearer ' + token;
  }

  await throttle(url.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { httpGetJson, ALLOWED_HOSTS, HOSTS };
