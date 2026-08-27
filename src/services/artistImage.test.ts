// Run: npx tsx src/services/artistImage.test.ts
// Network-free. The fixtures below are REAL Deezer payload shapes captured from
// api.deezer.com — including the two traps that make naive picking wrong.
import {
  deezerArtistSearchUrl,
  parseDeezerArtist,
  isPlaceholderImage,
  resolveArtistImage,
} from './artistImage';

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

const img = (hash: string, size = '500x500') =>
  `https://cdn-images.dzcdn.net/images/artist/${hash}/${size}-000000-80-0-0.jpg`;

const artist = (name: string, id: number, fans: number, hash = 'abc123') => ({
  id,
  name,
  link: `https://www.deezer.com/artist/${id}`,
  picture_medium: img(hash, '250x250'),
  picture_big: img(hash),
  nb_fan: fans,
});

// --- url ---------------------------------------------------------------------
ok(deezerArtistSearchUrl('Nas').startsWith('https://api.deezer.com/search/artist?'), 'search url');
ok(deezerArtistSearchUrl('Nas').includes('limit=10'), 'fetches a page, not just the top hit');
ok(deezerArtistSearchUrl('AC/DC').includes('q=AC%2FDC'), 'encodes the query');

// --- placeholder detection ---------------------------------------------------
// Deezer signals "no photo" with an EMPTY hash segment, not a default image.
ok(isPlaceholderImage(img('')), 'empty artist hash is a placeholder');
ok(isPlaceholderImage(undefined), 'undefined is a placeholder');
ok(!isPlaceholderImage(img('7e494327ae7a6ac19261bb6a21f2f9aa')), 'real hash is not a placeholder');

// --- the "Nas" trap ----------------------------------------------------------
// Real ordering from api.deezer.com: the exact artist is 5th, behind a 117-fan
// collab act. First-result-wins would cache the wrong face.
const nasPayload = {
  data: [
    artist('Nas & The Game', 301, 117, ''),
    artist('Nas & Damian "Jr. Gong" Marley', 302, 85259),
    artist('N.A.S', 303, 476),
    artist('Nas & Damian Marley', 304, 462),
    artist('Nas', 305, 1204577, 'realnashash'),
    artist('Bas', 306, 102557),
  ],
};
const nas = parseDeezerArtist(nasPayload, 'Nas');
eq(nas?.id, 305, 'picks the exact name match, not the top search result');
eq(nas?.name, 'Nas', 'exact match by name');
ok(nas!.imageUrl!.includes('realnashash'), 'returns the matched artist image');

// --- strictness --------------------------------------------------------------
eq(parseDeezerArtist({ data: [artist('Nas & The Game', 301, 117)] }, 'Nas'), null, 'no exact match -> null (never guess)');
eq(parseDeezerArtist({ data: [] }, 'Nas'), null, 'empty result');
eq(parseDeezerArtist({}, 'Nas'), null, 'malformed payload');
eq(parseDeezerArtist(null, 'Nas'), null, 'null payload');
eq(parseDeezerArtist({ data: [artist('Nas', 1, 5)] }, ''), null, 'blank wanted name -> null');

// Normalization: case/punctuation/diacritics must still match.
eq(parseDeezerArtist({ data: [artist('JAY-Z', 1, 100)] }, 'Jay-Z')?.id, 1, 'case-insensitive match');
eq(parseDeezerArtist({ data: [artist('Beyoncé', 2, 100)] }, 'Beyonce')?.id, 2, 'diacritic-insensitive match');
eq(parseDeezerArtist({ data: [artist('P!nk', 3, 100)] }, 'P!nk')?.id, 3, 'punctuation-insensitive match');
// The real-world mismatch: a tag says "Jay Z", Deezer says "JAY-Z". Punctuation
// normalizes to a SPACE (not to nothing) precisely so these two meet.
eq(parseDeezerArtist({ data: [artist('JAY-Z', 4, 100)] }, 'Jay Z')?.id, 4, 'hyphen matches a space');
// ...and the limit of that: "P!nk" cannot reach "Pink", since ! stands in for a
// letter. Strictness means we return nothing rather than the wrong artist.
eq(parseDeezerArtist({ data: [artist('P!nk', 5, 100)] }, 'Pink'), null, 'no fuzzy rescue for P!nk/Pink');

// Fan count only breaks ties BETWEEN exact matches.
eq(
  parseDeezerArtist({ data: [artist('Nas', 1, 500), artist('Nas', 2, 900000)] }, 'Nas')?.id,
  2,
  'most-followed exact match wins the tie'
);

// An exact match with no photo is still "no photo".
const noPic = parseDeezerArtist({ data: [artist('Ghost', 9, 10, '')] }, 'Ghost');
eq(noPic?.imageUrl, undefined, 'placeholder image is dropped');
eq(noPic?.thumbUrl, undefined, 'placeholder thumb is dropped');

// --- resolve -----------------------------------------------------------------
async function run() {
  {
    const out = await resolveArtistImage('Nas', async () => nasPayload);
    ok(!!out?.imageUrl?.includes('realnashash'), 'resolve returns the exact artist photo');
    ok(!!out?.thumbUrl?.includes('250x250'), 'resolve returns a 250px thumb for list rows');
  }
  {
    const out = await resolveArtistImage('Ghost', async () => ({ data: [artist('Ghost', 9, 10, '')] }));
    eq(out, null, 'exact match with only a placeholder resolves to null');
  }
  {
    const out = await resolveArtistImage('Nobody', async () => ({ data: [] }));
    eq(out, null, 'no match resolves to null, not an error');
  }
  {
    let threw = false;
    try {
      await resolveArtistImage('Nas', async () => {
        throw new Error('network down');
      });
    } catch {
      threw = true;
    }
    ok(threw, 'transport error propagates');
  }

  if (fail.length) {
    console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
    for (const f of fail) console.error('  ✗ ' + f + '\n');
    process.exit(1);
  }
  console.log(`  artistImage: ${passed} assertions passed`);
}

run();
