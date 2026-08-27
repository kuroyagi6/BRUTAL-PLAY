// Persistent downscaled cover-art thumbnails.
//
// Why this exists: covers are stored full-resolution (~284 KB / often 1000px+,
// see the cover-art notes in dbService), but the library views draw them at
// 48–168px. Decoding a full-size image per tile is what made album art pop in
// one-by-one and view switches stutter. This module shrinks each cover ONCE to
// THUMB_SIZE, persists the small blob, and hands out object URLs that decode in
// ~2 ms — so after the first encounter, art is effectively instant forever.
//
// Containment: this is a standalone layer. It owns its own IndexedDB database
// ('brutal-thumbs') so dbService's schema/version is untouched, it never
// mutates tracks, and callers opt in per <img>. Thumbs are keyed by track id —
// coverUrl object URLs are re-minted every session and can't be keys. If a
// file's embedded art changes the stale thumb sticks until the track is
// re-imported (new id); acceptable for a cache.

import { openDB, type IDBPDatabase } from 'idb';

const THUMB_SIZE = 256;
const DB_NAME = 'brutal-thumbs';
const STORE = 'thumbs';
const MAX_ACTIVE = 2; // decode jobs in flight — enough to hide latency, low enough not to jank

let dbPromise: Promise<IDBPDatabase> | null = null;
const db = () => (dbPromise ??= openDB(DB_NAME, 1, {
  upgrade(d) { d.createObjectStore(STORE); },
}));

// id -> session object URL. '' means generation failed for this id — callers
// fall back to the full-size cover instead of retrying every render.
const urls = new Map<string, string>();
const pending = new Set<string>();
const queue: Array<{ id: string; fullUrl: string }> = [];
let active = 0;

// Re-render signal for React (useSyncExternalStore shape). Notifies are
// batched: during a first-run warm of a whole library, thumbs complete every
// few hundred ms and we don't want a render per thumb.
let version = 0;
let notifyTimer: number | null = null;
const listeners = new Set<() => void>();
export const subscribeThumbs = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
export const thumbsVersion = () => version;
const notify = () => {
  if (notifyTimer !== null) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;
    version++;
    listeners.forEach((l) => l());
  }, 250);
};

/** Session-cached thumb URL: string = ready, '' = failed, undefined = not requested yet. */
export const getThumb = (id: string): string | undefined => urls.get(id);

async function makeThumb(fullUrl: string): Promise<Blob> {
  const source = await (await fetch(fullUrl)).blob();
  const bmp = await createImageBitmap(source);
  try {
    const scale = Math.min(1, THUMB_SIZE / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bmp.width * scale)),
      Math.max(1, Math.round(bmp.height * scale)),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  } finally {
    bmp.close();
  }
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift()!;
    active++;
    (async () => {
      try {
        const d = await db();
        let blob: Blob | undefined = await d.get(STORE, job.id);
        if (!blob) {
          blob = await makeThumb(job.fullUrl);
          await d.put(STORE, blob, job.id);
        }
        urls.set(job.id, URL.createObjectURL(blob));
      } catch {
        urls.set(job.id, '');
      } finally {
        pending.delete(job.id);
        active--;
        notify();
        pump();
      }
    })();
  }
}

/**
 * Ask for a thumb. On-screen callers use urgent=true to jump the queue ahead
 * of the background warm. Idempotent per id, cheap to call during render.
 */
export function requestThumb(id: string, fullUrl: string, urgent = false) {
  if (urls.has(id) || pending.has(id)) return;
  pending.add(id);
  if (urgent) queue.unshift({ id, fullUrl });
  else queue.push({ id, fullUrl });
  pump();
}

/**
 * Background-generate thumbs for a whole library so first-run pop-in happens
 * once, off-screen, instead of every time the user scrolls somewhere new.
 * Persisted thumbs just get their object URL minted (fast path in pump).
 */
export function warmThumbs(tracks: ReadonlyArray<{ id: string; coverUrl?: string }>) {
  for (const t of tracks) {
    if (t.coverUrl) requestThumb(t.id, t.coverUrl);
  }
}
