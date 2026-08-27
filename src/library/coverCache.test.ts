// Run with: npx tsx src/library/coverCache.test.ts
// Fakes URL.createObjectURL/revokeObjectURL so this runs without a DOM.
let nextId = 0;
const live = new Set<string>();
const made: string[] = [];

(globalThis as any).URL = {
  createObjectURL: () => {
    const url = `blob:fake-${nextId++}`;
    live.add(url);
    made.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => {
    live.delete(url);
  },
};
(globalThis as any).Blob = class {
  constructor(public parts: unknown[]) {}
} as unknown as typeof Blob;

const { acquireCover, releaseCover, clearCovers, coverCacheStats } = await import('./coverCache');

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// An album: 12 tracks, one image.
let blobsMade = 0;
const art = () => {
  blobsMade++;
  return new Blob(['art']);
};

const urls = Array.from({ length: 12 }, () => acquireCover('hash-album', art));

check('all album tracks share one url', new Set(urls).size, 1);
check('blob materialized once', blobsMade, 1);
check('one unique entry, 12 refs', coverCacheStats(), { unique: 1, refs: 12 });

// A different image is a different url.
const other = acquireCover('hash-other', () => new Blob(['b']));
check('distinct hash gets distinct url', other !== urls[0], true);
check('two unique entries', coverCacheStats().unique, 2);

// Removing 11 of 12 tracks must NOT revoke the shared url.
for (let i = 0; i < 11; i++) releaseCover('hash-album');
check('url still live while one track holds it', live.has(urls[0]), true);
check('one ref left', coverCacheStats().refs, 2); // 1 album + 1 other

// The last release revokes it.
releaseCover('hash-album');
check('url revoked when last ref drops', live.has(urls[0]), false);
check('entry evicted', coverCacheStats().unique, 1);

// Re-acquiring after eviction mints a fresh url (and a fresh blob).
const revived = acquireCover('hash-album', art);
check('re-acquire makes a new blob', blobsMade, 2);
check('re-acquired url is live', live.has(revived), true);

// Over-releasing is harmless — no negative refs, no double revoke.
releaseCover('hash-album');
releaseCover('hash-album');
releaseCover('never-existed');
check('over-release does not throw or wedge', coverCacheStats().unique, 1); // 'hash-other' remains

clearCovers();
check('clear revokes everything', live.size, 0);
check('clear empties the cache', coverCacheStats(), { unique: 0, refs: 0 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
