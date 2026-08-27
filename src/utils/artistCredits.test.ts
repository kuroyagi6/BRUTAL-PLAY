// Run: npx tsx src/utils/artistCredits.test.ts
// Pure — no network, no DOM. The interesting half is the NEGATIVE cases: a wrong
// split invents artists that don't exist and sends junk to a third-party API.
import { parseArtistCredits, splitArtists, normalizeArtist, collectArtists } from './artistCredits';

let passed = 0;
const fail: string[] = [];

function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else fail.push(`${what}\n    expected: ${e}\n    actual:   ${a}`);
}

// --- feature markers ---------------------------------------------------------
eq(splitArtists('Jay-Z feat. Kanye West'), ['Jay-Z', 'Kanye West'], 'feat.');
eq(splitArtists('Jay-Z ft. Kanye West'), ['Jay-Z', 'Kanye West'], 'ft.');
eq(splitArtists('Jay-Z featuring Kanye West'), ['Jay-Z', 'Kanye West'], 'featuring');
eq(splitArtists('Jay-Z FEAT Kanye West'), ['Jay-Z', 'Kanye West'], 'FEAT (caps, no dot)');
eq(splitArtists('Eminem (feat. Dido)'), ['Eminem', 'Dido'], 'parenthesised feature');
eq(splitArtists('Eminem [feat. Dido]'), ['Eminem', 'Dido'], 'bracketed feature');

const c = parseArtistCredits('Kanye West feat. Jay-Z & Rihanna');
eq(c.primary, ['Kanye West'], 'primary split off from features');
eq(c.featured, ['Jay-Z', 'Rihanna'], 'multiple featured artists');
eq(c.all, ['Kanye West', 'Jay-Z', 'Rihanna'], 'all = primary + featured');

// --- strong separators -------------------------------------------------------
eq(splitArtists('Drake;Future'), ['Drake', 'Future'], 'semicolon');
eq(splitArtists('Drake\0Future'), ['Drake', 'Future'], 'ID3v2.4 NUL separator');
eq(splitArtists('Sonny / Cher'), ['Sonny', 'Cher'], 'spaced slash');
eq(splitArtists('Kendrick Lamar vs. Drake'), ['Kendrick Lamar', 'Drake'], 'vs.');
eq(splitArtists('Skrillex x Diplo'), ['Skrillex', 'Diplo'], 'x collab marker');

// --- weak separators, allowed ------------------------------------------------
eq(splitArtists('Calvin Harris & Dua Lipa'), ['Calvin Harris', 'Dua Lipa'], 'ampersand');
eq(splitArtists('Drake, Future'), ['Drake', 'Future'], 'comma');
eq(splitArtists('Silk Sonic + Bruno Mars'), ['Silk Sonic', 'Bruno Mars'], 'plus');

// --- weak separators, GUARDED (must stay whole) ------------------------------
eq(splitArtists('Earth, Wind & Fire'), ['Earth, Wind & Fire'], 'known band w/ comma+amp');
eq(splitArtists('Tyler, The Creator'), ['Tyler, The Creator'], 'known name w/ comma');
eq(splitArtists('AC/DC'), ['AC/DC'], 'unspaced slash is not a separator');
eq(splitArtists('Simon & Garfunkel'), ['Simon & Garfunkel'], 'known duo');
eq(splitArtists('Crosby, Stills & Nash'), ['Crosby, Stills & Nash'], 'known trio');
eq(splitArtists('Florence + the Machine'), ['Florence + the Machine'], 'known band w/ plus');
eq(
  splitArtists('Nick Cave & The Bad Seeds'),
  ['Nick Cave & The Bad Seeds'],
  'unlisted "X & The Band" caught by the-rule'
);
eq(
  splitArtists('Bob Marley & The Wailers'),
  ['Bob Marley & The Wailers'],
  'the-rule generalises beyond the list'
);
eq(
  splitArtists('Huey Lewis and the News'),
  ['Huey Lewis and the News'],
  '"and the" caught by the-rule'
);

// A guarded band still splits at a feature marker, keeping the band intact.
const ewf = parseArtistCredits('Earth, Wind & Fire feat. Nas');
eq(ewf.primary, ['Earth, Wind & Fire'], 'guarded band survives as primary');
eq(ewf.featured, ['Nas'], 'feature still splits off a guarded band');

// --- dedupe + edge cases -----------------------------------------------------
eq(splitArtists('Nas feat. NAS'), ['Nas'], 'case-insensitive dedupe keeps first spelling');
eq(splitArtists('Radiohead'), ['Radiohead'], 'single artist untouched');
eq(splitArtists('  Radiohead  '), ['Radiohead'], 'trims');
eq(splitArtists(''), [], 'empty tag yields no credits');
eq(parseArtistCredits('').all, [], 'empty parse is safe');
eq(splitArtists('A, B, C, D, E'), ['A, B, C, D, E'], 'too many pieces = suspicious, no split');

// --- normalize ---------------------------------------------------------------
eq(normalizeArtist('JAY-Z'), 'jay z', 'normalize lowercases + strips punctuation');
eq(normalizeArtist('Beyoncé'), 'beyonce', 'normalize strips diacritics');
eq(normalizeArtist('  Sigur Rós '), 'sigur ros', 'normalize trims + collapses');

// --- collectArtists (the prefetch work list) ---------------------------------
eq(collectArtists([]), [], 'no tracks');
eq(
  collectArtists([{ artist: 'Nas' }, { artist: 'Nas' }, { artist: 'Jay-Z' }]),
  ['Nas', 'Jay-Z'],
  'dedupes repeated artists'
);
eq(
  collectArtists([{ artist: 'JAY-Z' }, { artist: 'Jay Z' }, { artist: 'jay-z' }]),
  ['JAY-Z'],
  'near-duplicates collapse to one lookup'
);
eq(
  collectArtists([{ artist: 'Nas feat. Damian Marley' }, { artist: 'Damian Marley' }]),
  ['Nas', 'Damian Marley'],
  'featured artists become their own lookups, deduped'
);
eq(
  collectArtists([{ artist: 'Unknown Artist' }, { artist: 'Various Artists' }, { artist: 'Nas' }]),
  ['Nas'],
  'skips unlookupable tags'
);
eq(collectArtists([{ artist: '' }, {}]), [], 'skips empty/missing tags');
eq(
  collectArtists([{ artist: 'Earth, Wind & Fire' }]),
  ['Earth, Wind & Fire'],
  'guarded band stays one lookup, not three'
);

// --- report ------------------------------------------------------------------
if (fail.length) {
  console.error(`\n  ${fail.length} FAILED of ${passed + fail.length}:\n`);
  for (const f of fail) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`  artistCredits: ${passed} assertions passed`);
