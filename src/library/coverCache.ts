// One object URL per unique cover image, shared by every track that embeds it.
//
// Album art is identical across an album's tracks, so a 12-track album used to
// mint 12 Blobs and 12 object URLs for the same bytes — all held for the whole
// session. Keying by content hash collapses that to one.
//
// Refcounting is the load-bearing part: revoking on the first track removal
// would blank the artwork on every sibling still pointing at that URL. The URL
// is revoked only when the last referencing track is gone.

interface Entry {
  url: string;
  refs: number;
}

const entries = new Map<string, Entry>();

/**
 * Get the shared object URL for a cover, creating it on first use.
 * `makeBlob` is only called on a miss, so callers can avoid materializing a Blob
 * for art that is already cached. Each acquire must be paired with one release.
 */
export function acquireCover(hash: string, makeBlob: () => Blob): string {
  const existing = entries.get(hash);
  if (existing) {
    existing.refs++;
    return existing.url;
  }
  const url = URL.createObjectURL(makeBlob());
  entries.set(hash, { url, refs: 1 });
  return url;
}

/** Drop one reference; revokes the URL when none remain. */
export function releaseCover(hash: string): void {
  const entry = entries.get(hash);
  if (!entry) return;
  if (--entry.refs <= 0) {
    URL.revokeObjectURL(entry.url);
    entries.delete(hash);
  }
}

/** Revoke everything. For teardown and clearAllData. */
export function clearCovers(): void {
  for (const { url } of entries.values()) URL.revokeObjectURL(url);
  entries.clear();
}

/** Live entry count and total references — for tests and diagnostics. */
export function coverCacheStats(): { unique: number; refs: number } {
  let refs = 0;
  for (const e of entries.values()) refs += e.refs;
  return { unique: entries.size, refs };
}
