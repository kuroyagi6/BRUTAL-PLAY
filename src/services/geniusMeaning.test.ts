// Run: npx tsx src/services/geniusMeaning.test.ts
// Network-free: every call goes through a fake getter, so this asserts the
// song-picking, parsing and fragment→line matching, not Genius' uptime.
import {
  geniusSearchUrl,
  geniusReferentsUrl,
  normalizeFragment,
  meaningsKey,
  parseSearchHits,
  pickBestSong,
  parseReferents,
  matchAnnotations,
  resolveSongAnnotations,
  isQueryable,
  PER_PAGE,
  type Annotation,
} from './geniusMeaning';

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

// --- URLs --------------------------------------------------------------------
const su = geniusSearchUrl({ artist: 'Nas', track: 'One Mic' });
ok(su.startsWith('https://api.genius.com/search?'), 'search url host/path');
ok(su.includes('q=Nas+One+Mic'), 'search query joins artist and track');
const ru = geniusReferentsUrl(2144, 2);
ok(ru.includes('song_id=2144'), 'referents url carries the song id');
ok(ru.includes('text_format=plain'), 'referents url asks for plain bodies (not html)');
ok(ru.includes('page=2'), 'referents url carries the page');

// --- normalization -----------------------------------------------------------
eq(normalizeFragment('[Chorus]\nDon’t stop!'), 'dont stop', 'section markers and punctuation are dropped');
eq(normalizeFragment('  Multiple   spaces '), 'multiple spaces', 'whitespace collapses');

// --- cache key ---------------------------------------------------------------
// The key must survive the differences between two copies of the same song, or
// the offline cache would miss and force a lookup that can't happen.
eq(meaningsKey({ artist: 'Nas', track: 'One Mic' }), 'nas|one mic', 'key is normalized artist|track');
eq(
  meaningsKey({ artist: 'NAS', track: "One  Mic!" }),
  meaningsKey({ artist: 'nas', track: 'One Mic' }),
  'case, spacing and punctuation do not split the cache'
);
ok(
  meaningsKey({ artist: 'Nas', track: 'One Mic' }) !== meaningsKey({ artist: 'Nas', track: 'Made You Look' }),
  'different songs get different keys'
);
ok(
  meaningsKey({ artist: 'A', track: 'B|C' }) !== meaningsKey({ artist: 'A|B', track: 'C' }),
  'the separator cannot be forged out of the fields'
);

// --- search hit parsing / song picking ---------------------------------------
const hitsRaw = {
  response: {
    hits: [
      { type: 'song', result: { id: 1, title: 'One Mic (Live)', primary_artist: { name: 'Nas' }, url: 'u1' } },
      { type: 'song', result: { id: 2, title: 'One Mic', primary_artist: { name: 'Nas' }, url: 'u2' } },
      { type: 'song', result: { id: 3, title: 'One Mic', primary_artist: { name: 'Cover Band' }, url: 'u3' } },
      { type: 'lyric', result: { id: 4, title: 'noise' } },
    ],
  },
};
const hits = parseSearchHits(hitsRaw);
eq(hits.length, 3, 'non-song hits are dropped');
eq(hits[0].artist, 'Nas', 'primary artist is lifted out');
eq(parseSearchHits(null).length, 0, 'a junk payload parses to no hits');
eq(parseSearchHits({ response: {} }).length, 0, 'a missing hits array parses to no hits');

eq(pickBestSong(hits, { artist: 'Nas', track: 'One Mic' })?.id, 2, 'exact title+artist beats the higher-ranked live take');
eq(pickBestSong(hits, { artist: 'Cover Band', track: 'One Mic' })?.id, 3, 'artist decides between identical titles');
eq(pickBestSong(hits, { artist: 'Nas', track: 'Made You Look' }), null, 'no title match means no song');
eq(pickBestSong([], { artist: 'Nas', track: 'One Mic' }), null, 'no hits means no song');

// --- referent parsing --------------------------------------------------------
const refRaw = {
  response: {
    referents: [
      {
        fragment: 'the rain came down',
        annotations: [
          { body: { plain: 'low-voted take' }, votes_total: 1, url: 'a1' },
          { body: { plain: 'the real meaning' }, votes_total: 42, url: 'a2' },
        ],
      },
      { fragment: '', annotations: [{ body: { plain: 'orphan' }, votes_total: 5 }] },
      { fragment: 'no body here', annotations: [{ body: { plain: '   ' }, votes_total: 5 }] },
      { fragment: 'no annotations', annotations: [] },
    ],
  },
};
const refs = parseReferents(refRaw);
eq(refs.length, 1, 'fragments without a usable annotation body are dropped');
eq(refs[0].body, 'the real meaning', 'the top-voted annotation wins');
eq(refs[0].votes, 42, 'votes are kept');
eq(refs[0].url, 'a2', 'the winning annotation carries its own permalink');
eq(parseReferents({}).length, 0, 'a junk payload parses to no referents');

// --- fragment -> line matching ----------------------------------------------
const ann = (fragment: string, body: string): Annotation => ({ fragment, body, votes: 1 });

{
  const lines = ['I woke up this morning', 'and the rain came down', 'right on my head'];
  const out = matchAnnotations(lines, [ann('and the rain came down', 'about grief')]);
  eq(out[1]?.body, 'about grief', 'an exact fragment lands on its line');
  eq(out[0], null, 'other lines stay unannotated');
}

{
  // Genius fragments carry the original punctuation/case; LRC lines may not.
  const lines = ["Dont stop believin"];
  const out = matchAnnotations(lines, [ann("Don't stop believin'", 'the hook')]);
  eq(out[0]?.body, 'the hook', 'punctuation differences still match');
}

{
  // A multi-line fragment annotates every line it covers, so pausing mid-couplet
  // still shows the meaning.
  const lines = ['first half of it', 'second half of it', 'unrelated line'];
  const out = matchAnnotations(lines, [ann('first half of it\nsecond half of it', 'couplet')]);
  eq(out[0]?.body, 'couplet', 'multi-line fragment covers its first line');
  eq(out[1]?.body, 'couplet', 'multi-line fragment covers its second line');
  eq(out[2], null, 'and nothing else');
}

{
  // Short interjections must not match everywhere.
  const lines = ['oh', 'yeah', 'a real lyric line'];
  const out = matchAnnotations(lines, [ann('oh', 'meaningless')]);
  eq(out, [null, null, null], 'fragments below the length floor are ignored');
}

{
  // Repeated chorus: annotations arrive in song order, so the second annotation
  // should land on the LATER copy rather than re-matching the first.
  const lines = ['same words again', 'a verse line here', 'same words again'];
  const out = matchAnnotations(lines, [
    ann('a verse line here', 'verse note'),
    ann('same words again', 'chorus note'),
  ]);
  eq(out[1]?.body, 'verse note', 'the verse annotation lands on the verse');
  eq(out[2]?.body, 'chorus note', 'a repeated line takes the forward copy');
  eq(out[0], null, 'the earlier copy is left for an earlier annotation');
}

{
  const out = matchAnnotations([], [ann('anything at all', 'x')]);
  eq(out, [], 'no lines means no matches');
}

// --- queryable ---------------------------------------------------------------
ok(isQueryable({ artist: 'Nas', track: 'One Mic' }), 'tagged track is queryable');
ok(!isQueryable({ artist: '', track: 'One Mic' }), 'missing artist is not queryable');
ok(!isQueryable({ artist: 'Unknown Artist', track: 'x' }), 'Unknown Artist is not queryable');

// --- orchestration -----------------------------------------------------------
async function run() {
  // Happy path: one search + one page of referents.
  {
    const calls: string[] = [];
    const res = await resolveSongAnnotations({ artist: 'Nas', track: 'One Mic' }, async (u) => {
      calls.push(u);
      return u.includes('/search') ? hitsRaw : refRaw;
    });
    eq(res?.song.id, 2, 'resolves to the right song');
    eq(res?.annotations.length, 1, 'returns its annotations');
    eq(calls.length, 2, 'a short song costs one search + one referents page');
  }

  // A full page means there may be more; a short page stops the paging.
  {
    const full = {
      response: {
        referents: Array.from({ length: PER_PAGE }, (_, i) => ({
          fragment: `fragment number ${i}`,
          annotations: [{ body: { plain: `body ${i}` }, votes_total: 1 }],
        })),
      },
    };
    let pages = 0;
    const res = await resolveSongAnnotations({ artist: 'Nas', track: 'One Mic' }, async (u) => {
      if (u.includes('/search')) return hitsRaw;
      pages++;
      return pages === 1 ? full : refRaw; // page 2 is short -> stop
    });
    eq(pages, 2, 'a full page is followed by one more');
    eq(res?.annotations.length, PER_PAGE + 1, 'annotations from both pages are kept');
  }

  // A page of referents that all lack bodies still has a next page: paging must
  // key off the RAW count, not the parsed one.
  {
    const bodiless = {
      response: {
        referents: Array.from({ length: PER_PAGE }, () => ({ fragment: 'x y z', annotations: [] })),
      },
    };
    let pages = 0;
    const res = await resolveSongAnnotations({ artist: 'Nas', track: 'One Mic' }, async (u) => {
      if (u.includes('/search')) return hitsRaw;
      pages++;
      return pages === 1 ? bodiless : refRaw;
    });
    eq(pages, 2, 'a full page that parses to nothing does not stop paging');
    eq(res?.annotations.length, 1, 'the next page still contributes');
  }

  // No confident song -> null, and no referents request.
  {
    const calls: string[] = [];
    const res = await resolveSongAnnotations({ artist: 'Nobody', track: 'Nothing At All' }, async (u) => {
      calls.push(u);
      return hitsRaw;
    });
    eq(res, null, 'no song match returns null');
    eq(calls.length, 1, 'and never asks for referents');
  }

  // Transport/auth failure must PROPAGATE, so the UI can tell "bad token" from
  // "this song has no annotations".
  {
    let threw = false;
    try {
      await resolveSongAnnotations({ artist: 'Nas', track: 'One Mic' }, async () => {
        throw new Error('HTTP 401');
      });
    } catch {
      threw = true;
    }
    ok(threw, 'a failed request propagates (401 is distinct from not-found)');
  }

  // Unqueryable never touches the network.
  {
    let called = false;
    const res = await resolveSongAnnotations({ artist: '', track: 'x' }, async () => {
      called = true;
      return hitsRaw;
    });
    eq(res, null, 'unqueryable returns null');
    ok(!called, 'unqueryable makes no request');
  }

  if (fail.length) {
    console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
    for (const f of fail) console.error('  ✗ ' + f + '\n');
    process.exit(1);
  }
  console.log(`  geniusMeaning: ${passed} assertions passed`);
}

run();
