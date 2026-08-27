import { openDB, IDBPDatabase } from 'idb';
import type { VideoItem } from '../types';

// Persistence for the video library. Deliberately its OWN IndexedDB database,
// separate from the audio `brutal-player-db`: videos must never share a schema,
// a version number, or a transaction with tracks, so a change here can't corrupt
// or block the (audio-critical) track store. This mirrors dbService but is far
// smaller — a video row is just metadata + its native path. The bytes stay on
// disk and stream over local-media://, so unlike tracks there is no blob stored.

const DB_NAME = 'brutal-player-videos-db';
const STORE_NAME = 'videos';
const DB_VERSION = 1;

/** What actually lives in the store — VideoItem minus the runtime-minted `url`. */
export type StoredVideo = Omit<VideoItem, 'url'>;

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

const toStored = (v: VideoItem): StoredVideo => ({
  id: v.id,
  name: v.name,
  nativePath: v.nativePath,
  duration: v.duration,
  width: v.width,
  height: v.height,
  size: v.size,
});

export const getAllVideos = async (): Promise<StoredVideo[]> => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

/** Persist a batch in one transaction. Returns the ids that failed to write. */
export const saveVideos = async (videos: VideoItem[]): Promise<string[]> => {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const failed: string[] = [];
  await Promise.all(
    videos.map((v) =>
      tx.objectStore(STORE_NAME).put(toStored(v)).catch(() => {
        failed.push(v.id);
      })
    )
  );
  await tx.done;
  return failed;
};

/** Merge in newly-learned fields (duration/dimensions) after first playback. */
export const updateVideo = async (id: string, updates: Partial<StoredVideo>): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const existing = (await store.get(id)) as StoredVideo | undefined;
  if (existing) await store.put({ ...existing, ...updates, id });
  await tx.done;
};

export const deleteVideo = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
};

/** Total on-disk size of the imported videos we know about. */
export const videoUsageOf = (videos: Iterable<StoredVideo>): number => {
  let sum = 0;
  for (const v of videos) sum += v.size || 0;
  return sum;
};
