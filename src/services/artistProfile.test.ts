// Run with: npx tsx src/services/artistProfile.test.ts
// Pure tests for the artist-profile resolver — a fake JsonGetter stands in for
// the network, so the whole MusicBrainz -> Wikidata -> Wikipedia sequence is
// exercised without a single request.
import {
  parseMbArtist,
  parseRelations,
  wikipediaTitleFromUrl,
  parseWikipediaSummary,
  wikidataIdFromUrl,
  parseWikidataEnwikiTitle,
  resolveArtistProfile,
  mbArtistSearchUrl,
  type JsonGetter,
} from './artistProfile';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('FAIL:', msg);
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}`);
}

// --- parsers ---
assert(parseMbArtist({ artists: [] }) === null, 'empty search -> null');
eq(
  parseMbArtist({ artists: [{ id: 'abc', name: 'Nas', disambiguation: 'US rapper', country: 'US' }] }),
  { mbid: 'abc', name: 'Nas', disambiguation: 'US rapper', country: 'US' },
  'parseMbArtist maps fields'
);

const rels = parseRelations({
  relations: [
    { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Nas' } },
    { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q102301' } },
    { type: 'official homepage', url: { resource: 'https://example.com' } },
  ],
  tags: [
    { name: 'hip hop', count: 5 },
    { name: 'rap', count: 3 },
    { name: 'noise', count: 0 },
  ],
});
eq(rels.wikipediaUrl, 'https://en.wikipedia.org/wiki/Nas', 'relations pick wikipedia');
eq(rels.wikidataUrl, 'https://www.wikidata.org/wiki/Q102301', 'relations pick wikidata');
eq(rels.tags, ['hip hop', 'rap'], 'tags sorted by count, zero dropped');

eq(
  wikipediaTitleFromUrl('https://en.wikipedia.org/wiki/Nas'),
  { lang: 'en', title: 'Nas' },
  'wikipedia title parse'
);
eq(
  wikipediaTitleFromUrl('https://de.wikipedia.org/wiki/Kraftwerk'),
  { lang: 'de', title: 'Kraftwerk' },
  'non-en language captured'
);
assert(wikipediaTitleFromUrl('https://example.com/x') === null, 'non-wikipedia url -> null');

eq(
  parseWikipediaSummary({ extract: 'Bio here', originalimage: { source: 'http://img/a.jpg' } }),
  { bio: 'Bio here', imageUrl: 'http://img/a.jpg' },
  'summary prefers originalimage'
);
eq(
  parseWikipediaSummary({ extract: 'Bio', thumbnail: { source: 'http://img/thumb.jpg' } }),
  { bio: 'Bio', imageUrl: 'http://img/thumb.jpg' },
  'summary falls back to thumbnail'
);

eq(wikidataIdFromUrl('https://www.wikidata.org/wiki/Q102301'), 'Q102301', 'wikidata id parse');
eq(
  parseWikidataEnwikiTitle(
    { entities: { Q1: { sitelinks: { enwiki: { title: 'Kraftwerk' } } } } },
    'Q1'
  ),
  'Kraftwerk',
  'wikidata enwiki sitelink'
);

// --- orchestration: full happy path via a fake getter keyed by URL ---
function fakeGetter(map: Record<string, any>): JsonGetter {
  return async (url: string) => {
    for (const key of Object.keys(map)) if (url.includes(key)) return map[key];
    throw new Error('unexpected url ' + url);
  };
}

(async () => {
  const get = fakeGetter({
    'ws/2/artist/?query': { artists: [{ id: 'MBID1', name: 'Nas', country: 'US' }] },
    'ws/2/artist/MBID1': {
      relations: [{ type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Nas' } }],
      tags: [{ name: 'hip hop', count: 10 }],
    },
    'page/summary/Nas': { extract: 'American rapper.', originalimage: { source: 'http://img/nas.jpg' } },
  });
  const p = await resolveArtistProfile('Nas', get);
  eq(p.name, 'Nas', 'resolve: name');
  eq(p.mbid, 'MBID1', 'resolve: mbid');
  eq(p.bio, 'American rapper.', 'resolve: bio from wikipedia');
  eq(p.imageUrl, 'http://img/nas.jpg', 'resolve: image');
  eq(p.tags, ['hip hop'], 'resolve: tags');
  eq(p.sources.map((s) => s.label), ['MusicBrainz', 'Wikipedia'], 'resolve: attribution');
  assert(!p.notFound, 'resolve: found');

  // not found -> stub, no throw
  const p2 = await resolveArtistProfile('Nobody', fakeGetter({ 'ws/2/artist/?query': { artists: [] } }));
  assert(p2.notFound === true, 'resolve: notFound stub');

  // wikidata bridge when only a wikidata link exists
  const get3 = fakeGetter({
    'ws/2/artist/?query': { artists: [{ id: 'MB2', name: 'Kraftwerk' }] },
    'ws/2/artist/MB2': {
      relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q2' } }],
      tags: [],
    },
    'EntityData/Q2': { entities: { Q2: { sitelinks: { enwiki: { title: 'Kraftwerk' } } } } },
    'page/summary/Kraftwerk': { extract: 'German band.', thumbnail: { source: 'http://img/k.jpg' } },
  });
  const p3 = await resolveArtistProfile('Kraftwerk', get3);
  eq(p3.bio, 'German band.', 'resolve via wikidata bridge: bio');
  eq(p3.imageUrl, 'http://img/k.jpg', 'resolve via wikidata bridge: image');

  // sanity: search url escapes quotes
  assert(!mbArtistSearchUrl('AC/DC "live"').includes('"live"'), 'search url strips raw quotes');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
