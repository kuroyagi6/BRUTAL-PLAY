// Run: npx tsx src/services/lyricsFetch.test.ts
// Network-free: every call goes through a fake getter, so this asserts the
// sequencing/ranking logic, not LRCLIB's uptime.
import {
  lrclibGetUrl,
  lrclibSearchUrl,
  parseLyricsRecord,
  pickBestLyrics,
  resolveLyrics,
  isQueryable,
  queryFromTrack,
} from './lyricsFetch';
import type { Track } from '../types';

let passed = 0;
const fail: string[] = [];

function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else fail.push(`${what}\n    expected: ${e}\n    actual:   ${a}`);
}
function ok(cond: boolean, what: string) {
  if (cond) passed++;
  else fail.push(what);
}

// --- URL building ------------------------------------------------------------
const getUrl = lrclibGetUrl({ artist: 'Nas', track: 'One Mic', album: 'Stillmatic', duration: 272.4 });
ok(getUrl.startsWith('https://lrclib.net/api/get?'), 'get url host/path');
ok(getUrl.includes('duration=272'), 'get url rounds duration to whole seconds');
ok(getUrl.includes('artist_name=Nas'), 'get url carries artist');
ok(
  lrclibGetUrl({ artist: 'AC/DC', track: 'T.N.T. & More', album: 'A', duration: 1 }).includes('AC%2FDC'),
  'get url encodes separators in names'
);
ok(
  lrclibSearchUrl({ artist: 'Sigur Rós', track: 'Hoppípolla' }).includes('artist_name=Sigur+R%C3%B3s'),
  'search url encodes non-ascii'
);

// --- record parsing ----------------------------------------------------------
eq(parseLyricsRecord(null), null, 'null record');
eq(parseLyricsRecord({}), null, 'empty record has nothing usable');
eq(parseLyricsRecord({ plainLyrics: null, syncedLyrics: null, instrumental: false }), null, 'all-null record');
eq(
  parseLyricsRecord({ instrumental: true, plainLyrics: null, syncedLyrics: null })?.instrumental,
  true,
  'instrumental is a real answer, not a miss'
);
const rec = parseLyricsRecord({
  syncedLyrics: '[00:06.38] One time',
  plainLyrics: 'One time',
  instrumental: false,
  duration: 272.0,
  trackName: 'One Mic',
  artistName: 'Nas',
  albumName: 'Stillmatic',
});
eq(rec?.synced, '[00:06.38] One time', 'keeps raw LRC text');
eq(rec?.duration, 272, 'keeps duration');

// --- ranking -----------------------------------------------------------------
eq(pickBestLyrics([], 200), null, 'no candidates');
eq(
  pickBestLyrics(
    [
      { plainLyrics: 'plain', duration: 239 },
      { syncedLyrics: '[00:01.00] synced', duration: 300 },
    ],
    239
  )?.synced,
  '[00:01.00] synced',
  'synced outranks a plain hit with a perfect duration'
);
eq(
  pickBestLyrics(
    [
      { syncedLyrics: '[00:01.00] radio edit', duration: 200 },
      { syncedLyrics: '[00:01.00] album version', duration: 239 },
    ],
    239
  )?.synced,
  '[00:01.00] album version',
  'closest duration wins between two synced hits'
);
eq(
  pickBestLyrics([{ syncedLyrics: '[00:01.00] only', duration: 999 }], 239)?.synced,
  '[00:01.00] only',
  'a far-off duration still beats nothing'
);
eq(
  pickBestLyrics([{ plainLyrics: 'a', duration: 100 }, { plainLyrics: 'b', duration: 240 }], 239)?.plain,
  'b',
  'duration ranks plain hits too'
);
ok(pickBestLyrics([{ syncedLyrics: '[00:01.00] x', duration: 240 }])?.synced === '[00:01.00] x',
  'ranking works with no duration known');

// --- queryable guard ---------------------------------------------------------
ok(isQueryable({ artist: 'Nas', track: 'One Mic' }), 'normal query');
ok(!isQueryable({ artist: '', track: 'One Mic' }), 'blank artist not queryable');
ok(!isQueryable({ artist: 'Nas', track: '' }), 'blank track not queryable');
ok(!isQueryable({ artist: 'Unknown Artist', track: 'x' }), 'Unknown Artist not queryable');
ok(!isQueryable({ artist: 'Various Artists', track: 'x' }), 'Various Artists not queryable');

const t = { id: '1', name: 'One Mic', artist: 'Nas', album: 'Stillmatic', url: '', duration: 272 } as Track;
eq(queryFromTrack(t), { artist: 'Nas', track: 'One Mic', album: 'Stillmatic', duration: 272 }, 'query from track');
eq(queryFromTrack({ ...t, album: '  ' }).album, undefined, 'blank album becomes undefined');

// --- orchestration -----------------------------------------------------------
async function run() {
  // Exact hit: search must never be called.
  {
    const calls: string[] = [];
    const hit = await resolveLyrics({ artist: 'Nas', track: 'One Mic', album: 'Stillmatic', duration: 272 }, async (u) => {
      calls.push(u);
      if (u.includes('/api/get')) return { syncedLyrics: '[00:06.38] exact', instrumental: false, duration: 272 };
      throw new Error('search should not be reached');
    });
    eq(hit?.synced, '[00:06.38] exact', 'exact endpoint short-circuits');
    eq(calls.length, 1, 'exact hit costs exactly one request');
  }

  // 404 on exact -> falls through to search.
  {
    const calls: string[] = [];
    const hit = await resolveLyrics({ artist: 'Radiohead', track: 'Creep', album: 'Pablo Honey', duration: 239 }, async (u) => {
      calls.push(u);
      if (u.includes('/api/get')) throw new Error('HTTP 404');
      return [{ syncedLyrics: '[00:01.00] from search', instrumental: false, duration: 239 }];
    });
    eq(hit?.synced, '[00:01.00] from search', '404 on exact falls back to search');
    eq(calls.length, 2, 'fallback costs two requests');
    ok(calls[1].includes('/api/search'), 'second call is the search endpoint');
  }

  // No album/duration -> straight to search, no wasted exact call.
  {
    const calls: string[] = [];
    await resolveLyrics({ artist: 'Nas', track: 'One Mic' }, async (u) => {
      calls.push(u);
      return [];
    });
    eq(calls.length, 1, 'missing album/duration skips the exact call');
    ok(calls[0].includes('/api/search'), 'goes straight to search');
  }

  // Search finds nothing -> null, NOT a throw.
  {
    const hit = await resolveLyrics({ artist: 'Nobody', track: 'Nothing' }, async () => []);
    eq(hit, null, 'empty search result is null, not an error');
  }

  // Transport failure must PROPAGATE so the UI can say "offline" vs "no lyrics".
  {
    let threw = false;
    try {
      await resolveLyrics({ artist: 'Nas', track: 'One Mic', album: 'Stillmatic', duration: 272 }, async () => {
        throw new Error('network down');
      });
    } catch {
      threw = true;
    }
    ok(threw, 'transport error propagates (offline is distinct from not-found)');
  }

  // Unqueryable never touches the network.
  {
    let called = false;
    const hit = await resolveLyrics({ artist: 'Unknown Artist', track: 'x' }, async () => {
      called = true;
      return [];
    });
    eq(hit, null, 'unqueryable returns null');
    ok(!called, 'unqueryable makes no request');
  }

  if (fail.length) {
    console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
    for (const f of fail) console.error('  ✗ ' + f + '\n');
    process.exit(1);
  }
  console.log(`  lyricsFetch: ${passed} assertions passed`);
}

run();
