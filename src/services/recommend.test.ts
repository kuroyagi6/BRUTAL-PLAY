// Run: npx tsx src/services/recommend.test.ts
// Network-free. Fixtures mirror REAL api.deezer.com payload shapes for
// /search/artist, /artist/{id}/top and /artist/{id}/related.
//
// The interesting cases are all in the title matching: the feature is only
// useful if "you already own this" is judged correctly, and tagged libraries
// and Deezer disagree about suffixes constantly.
import type { Track } from '../types';
import {
  deezerRelatedUrl,
  itunesArtistTracksUrl,
  normalizeTitle,
  parseItunesTracks,
  parseDeezerTopTracks,
  parseDeezerRelated,
  ownedTitles,
  missingTracks,
  ownedArtists,
  scanArtist,
  collateScans,
  scanCandidates,
  youtubeSearchUrl,
} from './recommend';

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

// ---------------------------------------------------------------- fixtures
const track = (name: string, artist: string, id = name): Track =>
  ({ id, name, artist, album: '', path: '', duration: 200 } as unknown as Track);

const dzTrack = (id: number, title: string, artist: string, rank = 100) => ({
  id,
  title,
  title_short: title,
  duration: 210,
  rank,
  link: `https://www.deezer.com/track/${id}`,
  preview: `https://cdn-preview.dzcdn.net/${id}.mp3`,
  artist: { name: artist },
  album: { title: 'Some Album', cover_medium: 'https://cdn/cover.jpg' },
});

const dzArtist = (id: number, name: string, fans: number, hash = 'abc') => ({
  id,
  name,
  nb_fan: fans,
  picture_medium: `https://cdn-images.dzcdn.net/images/artist/${hash}/250x250-000000-80-0-0.jpg`,
  link: `https://www.deezer.com/artist/${id}`,
});

const itTrack = (id: number, track: string, artist: string, album = 'Some Album') => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: id,
  trackName: track,
  artistName: artist,
  collectionName: album,
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg',
  trackViewUrl: `https://music.apple.com/track/${id}`,
  previewUrl: `https://audio-ssl.itunes.apple.com/${id}.m4a`,
  trackTimeMillis: 215000,
});

// ---------------------------------------------------------------- URLs
eq(
  itunesArtistTracksUrl('Nas', 5),
  'https://itunes.apple.com/search?term=Nas&entity=song&attribute=artistTerm&limit=5',
  'itunes track url'
);
eq(
  itunesArtistTracksUrl('Tyler, The Creator', 2),
  'https://itunes.apple.com/search?term=Tyler%2C+The+Creator&entity=song&attribute=artistTerm&limit=2',
  'itunes url encodes the artist'
);
eq(deezerRelatedUrl(27, 3), 'https://api.deezer.com/artist/27/related?limit=3', 'related url');

// ---------------------------------------------------------------- normalizeTitle
eq(normalizeTitle('One Mic'), 'one mic', 'plain title');
eq(normalizeTitle('One Mic (Remastered 2011)'), 'one mic', 'parenthetical remaster dropped');
eq(normalizeTitle('One Mic - Remastered 2011'), 'one mic', 'dash remaster dropped');
eq(normalizeTitle('Got Ur Self A... (feat. Nas)'), 'got ur self a', 'feature in brackets dropped');
eq(normalizeTitle('Hate Me Now feat. Puff Daddy'), 'hate me now', 'bare feature tail dropped');
eq(normalizeTitle('N.Y. State of Mind'), 'n y state of mind', 'punctuation flattened');
eq(normalizeTitle('Café  Solo'), 'cafe solo', 'diacritics stripped and spaces collapsed');
eq(normalizeTitle('Salt & Pepa'), 'salt and pepa', 'ampersand spelled out');
eq(normalizeTitle('Song - Live at Wembley'), 'song', 'live suffix dropped');
// Guard against over-stripping: a title that merely CONTAINS a keyword survives.
eq(normalizeTitle('Live and Let Die'), 'live and let die', 'keyword inside a real title kept');
eq(normalizeTitle('Remaster'), 'remaster', 'keyword as the whole title kept');

// ---------------------------------------------------------------- parse top
{
  const json = {
    data: [
      dzTrack(1, 'One Mic', 'Nas', 500),
      dzTrack(2, 'One Mic (Remastered)', 'Nas', 400), // dupe of #1 after normalizing
      dzTrack(3, 'Made You Look', 'Nas', 900),
      dzTrack(4, 'Guest Spot', 'Damian Marley', 800), // not the searched artist
      { id: 5 }, // junk row
    ],
  };
  const out = parseDeezerTopTracks(json, 'Nas');
  eq(out.map((t) => t.title), ['Made You Look', 'One Mic'], 'top: deduped, filtered, rank-sorted');
  eq(out[0].id, 'deezer:3', 'top: stable deezer id');
  ok(!!out[0].previewUrl && !!out[0].link, 'top: carries preview + link');
}

// ---------------------------------------------------------------- parse itunes
{
  const json = {
    resultCount: 5,
    results: [
      itTrack(1, 'Made You Look', 'Nas'),
      itTrack(2, 'One Mic', 'Nas'),
      itTrack(3, 'One Mic (Remastered)', 'Nas'), // dupe of #2 once normalized
      itTrack(4, 'Some Song', 'Nirvana UK'), // artistTerm matches loosely
      { kind: 'song', trackName: 'No Id' }, // junk row
    ],
  };
  const out = parseItunesTracks(json, 'Nas');
  eq(out.map((t) => t.title), ['Made You Look', 'One Mic'], 'itunes: deduped, foreign artist dropped');
  eq(out[0].id, 'itunes:1', 'itunes: stable id');
  eq(out[0].duration, 215, 'itunes: ms -> seconds');
  eq(out[0].coverUrl, 'https://is1-ssl.mzstatic.com/image/thumb/x/200x200bb.jpg', 'itunes: art upsized');
  ok(out[0].rank > out[1].rank, 'itunes: relevance order becomes descending rank');
  ok(!!out[0].link && out[0].link.startsWith('https://music.apple.com/'), 'itunes: links to Apple');
}
{
  // A non-song result (audiobook/podcast) must not become a track suggestion.
  const json = { results: [{ kind: 'podcast', trackId: 9, trackName: 'X', artistName: 'Nas' }] };
  eq(parseItunesTracks(json, 'Nas').length, 0, 'itunes: non-song kinds ignored');
}
{
  eq(parseItunesTracks({ results: [] }, 'Nas'), [], 'itunes: empty payload is empty, not a throw');
}

// ---------------------------------------------------------------- parse related
{
  const json = { data: [dzArtist(1, 'Mobb Deep', 100), dzArtist(2, 'Rakim', 900), { id: 3 }] };
  const out = parseDeezerRelated(json, 'Nas');
  eq(out.map((a) => a.name), ['Rakim', 'Mobb Deep'], 'related: fans-sorted, junk dropped');
  eq(out[0].via, 'Nas', 'related: records who suggested it');
}
{
  // Deezer returns an empty artist hash when it has no photo.
  const noPic = { ...dzArtist(9, 'Ghost', 5), picture_medium: 'https://cdn-images.dzcdn.net/images/artist//250x250-000000-80-0-0.jpg' };
  eq(parseDeezerRelated({ data: [noPic] }, 'x')[0].thumbUrl, undefined, 'related: placeholder photo -> undefined');
}

// ---------------------------------------------------------------- library diff
{
  const lib = [
    track('One Mic', 'Nas'),
    track('Got Ur Self A... (feat. Nas)', 'Nas feat. Lauryn Hill'),
    track('Shook Ones', 'Mobb Deep'),
  ];
  const owned = ownedTitles(lib, 'Nas');
  ok(owned.has('one mic'), 'owned: exact credit counted');
  ok(owned.has('got ur self a'), 'owned: "Nas feat. X" still counts as a Nas track');
  ok(!owned.has('shook ones'), 'owned: another artist not counted');

  const suggestions = parseDeezerTopTracks(
    { data: [dzTrack(1, 'One Mic - Remastered 2011', 'Nas', 500), dzTrack(2, 'Made You Look', 'Nas', 900)] },
    'Nas'
  );
  eq(
    missingTracks(suggestions, owned).map((t) => t.title),
    ['Made You Look'],
    'missing: a remaster of an owned track is NOT suggested'
  );

  eq([...ownedArtists(lib)].sort(), ['mobb deep', 'nas', 'nas feat lauryn hill'], 'ownedArtists');
}

// ---------------------------------------------------------------- scanArtist
// Tracks come from iTunes, neighbours from Deezer. The halves must be
// independent: coupling them is what shipped a report of 145 artists and zero
// tracks in a region where Deezer withholds track payloads.
const okGet = (opts: { itunes?: any; search?: any; related?: any } = {}) => async (url: string) => {
  if (url.includes('itunes.apple.com')) {
    return opts.itunes ?? { results: [itTrack(1, 'One Mic', 'Nas'), itTrack(2, 'Made You Look', 'Nas')] };
  }
  if (url.includes('/search/artist')) return opts.search ?? { data: [dzArtist(27, 'Nas', 1200000)] };
  if (url.includes('/related')) return opts.related ?? { data: [dzArtist(3, 'Rakim', 900)] };
  throw new Error('unexpected url ' + url);
};

{
  const lib = [track('One Mic', 'Nas')];
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    return okGet()(url);
  };

  const scan = await scanArtist('Nas', lib, get, { topLimit: 10, relatedLimit: 4 });
  eq(scan.missing.map((t) => t.title), ['Made You Look'], 'scanArtist: subtracts the library');
  eq(scan.related.map((a) => a.name), ['Rakim'], 'scanArtist: returns neighbours');
  eq(scan.notFound, false, 'scanArtist: found');
  ok(calls.length === 3, 'scanArtist: one iTunes + two Deezer requests');
  ok(calls[0].includes('itunes') && calls[0].includes('limit=10'), 'scanArtist: honours topLimit');
  ok(calls[2].includes('limit=4'), 'scanArtist: honours relatedLimit');
}
{
  // THE REGRESSION: Deezer returns its region-blocked shape for tracks and the
  // artist lookup still works. Tracks must arrive anyway, from iTunes.
  const get = okGet({ search: { data: [dzArtist(27, 'Nas', 1200000)] } });
  const scan = await scanArtist('Nas', [], get);
  ok(scan.missing.length === 2, 'scanArtist: tracks survive a Deezer track blackout');
  ok(scan.related.length === 1, 'scanArtist: and neighbours still come through');
}
{
  // Deezer down entirely -> still report tracks.
  const get = async (url: string) => {
    if (url.includes('itunes.apple.com')) return { results: [itTrack(1, 'Made You Look', 'Nas')] };
    throw new Error('deezer unreachable');
  };
  const scan = await scanArtist('Nas', [], get);
  eq(scan.missing.map((t) => t.title), ['Made You Look'], 'scanArtist: Deezer failure costs only neighbours');
  eq(scan.related, [], 'scanArtist: no neighbours when Deezer is down');
  eq(scan.notFound, false, 'scanArtist: having tracks means found');
}
{
  // iTunes down -> still report neighbours.
  const get = async (url: string) => {
    if (url.includes('itunes.apple.com')) throw new Error('itunes 403');
    if (url.includes('/search/artist')) return { data: [dzArtist(27, 'Nas', 1200000)] };
    return { data: [dzArtist(3, 'Rakim', 900)] };
  };
  const scan = await scanArtist('Nas', [], get);
  eq(scan.missing, [], 'scanArtist: iTunes failure costs only tracks');
  eq(scan.related.map((a) => a.name), ['Rakim'], 'scanArtist: neighbours survive an iTunes 403');
}
{
  // Neither source knows the artist — a normal outcome, not a throw.
  const get = okGet({ itunes: { results: [] }, search: { data: [] } });
  const scan = await scanArtist('My Mate Dave', [], get);
  eq(scan, { artist: 'My Mate Dave', missing: [], related: [], notFound: true }, 'scanArtist: notFound');
}
{
  // BOTH sources failing is a real error the caller must be able to see.
  const get = async () => {
    throw new Error('offline');
  };
  let threw = false;
  try {
    await scanArtist('Nas', [], get);
  } catch {
    threw = true;
  }
  ok(threw, 'scanArtist: total transport failure propagates');
}

// ---------------------------------------------------------------- collate
{
  const lib = [track('Shook Ones', 'Mobb Deep')];
  const scans = [
    {
      artist: 'Nas',
      missing: [
        { id: 'deezer:2', title: 'Made You Look', artist: 'Nas', rank: 900 },
        { id: 'deezer:5', title: 'Shared', artist: 'Nas', rank: 100 },
      ],
      related: [
        { id: 1, name: 'Mobb Deep', fans: 100, via: 'Nas' }, // already owned
        { id: 2, name: 'Rakim', fans: 500, via: 'Nas' },
      ],
      notFound: false,
    },
    {
      artist: 'Jay-Z',
      missing: [
        { id: 'deezer:5', title: 'Shared', artist: 'Nas', rank: 100 }, // dupe id
        { id: 'deezer:9', title: 'Dead Presidents', artist: 'Jay-Z', rank: 950 },
      ],
      related: [{ id: 2, name: 'Rakim', fans: 700, via: 'Jay-Z' }], // dupe, more fans
      notFound: false,
    },
  ];
  const out = collateScans(scans as never, lib);
  eq(
    out.tracks.map((t) => t.title),
    ['Dead Presidents', 'Made You Look', 'Shared'],
    'collate: deduped by id, rank-sorted'
  );
  eq(out.artists.map((a) => a.name), ['Rakim'], 'collate: owned artist dropped, dupes merged');
  eq(out.artists[0].fans, 700, 'collate: keeps the strongest recommendation');
}

// ---------------------------------------------------------------- candidates
{
  const lib = [
    track('a', 'Nas', 'a'),
    track('b', 'Nas', 'b'),
    track('c', 'Nas', 'c'),
    track('d', 'Portishead', 'd'),
    track('e', 'Portishead', 'e'),
    track('f', 'One Hit Wonder', 'f'),
    track('g', 'Unknown Artist', 'g'),
    track('h', 'Various Artists', 'h'),
    track('i', '', 'i'),
  ];
  eq(scanCandidates(lib), ['Nas', 'Portishead', 'One Hit Wonder'], 'candidates: by track count, junk excluded');
  eq(scanCandidates(lib, 2), ['Nas', 'Portishead'], 'candidates: honours limit');
}

// ---------------------------------------------------------------- youtube handoff
eq(
  youtubeSearchUrl({ id: 'x', title: 'One Mic', artist: 'Nas', rank: 0 }),
  'https://www.youtube.com/results?search_query=Nas%20One%20Mic',
  'youtube search url'
);

// ---------------------------------------------------------------- report
if (fail.length) {
  console.error(`\n${fail.length} FAILED / ${passed} passed\n`);
  fail.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`\n✓ all ${passed} recommend assertions passed\n`);
