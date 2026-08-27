import { openDB, IDBPDatabase } from 'idb';

// Standalone IndexedDB for custom wallpaper image blobs. Kept separate from the
// tracks DB (dbService) so this feature can't affect the library store. Offline-
// safe: images live on disk as blobs.
//
// v1 stored a single image under the key 'custom'. This is now a *gallery* keyed
// by generated id — but the old 'custom' key still round-trips (getAllKeys returns
// it, so a pre-existing wallpaper shows up in the gallery and stays selectable).
const DB_NAME = 'brutal-player-wallpaper';
const STORE = 'images';

/** Key of the legacy single-image slot (v1). Still readable as a gallery entry. */
export const LEGACY_IMAGE_ID = 'custom';

let dbPromise: Promise<IDBPDatabase> | null = null;
const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
};

const genId = () => `wp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Store a new image; returns its generated id. */
export const saveWallpaperImage = async (blob: Blob): Promise<string> => {
  const db = await getDB();
  const id = genId();
  await db.put(STORE, blob, id);
  return id;
};

export const getWallpaperImage = async (id: string): Promise<Blob | undefined> => {
  const db = await getDB();
  return db.get(STORE, id);
};

/** Newest first (legacy 'custom' sorts last — it predates the timestamped ids). */
export const listWallpaperImageIds = async (): Promise<string[]> => {
  const db = await getDB();
  const keys = (await db.getAllKeys(STORE)) as string[];
  return keys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
};

export const deleteWallpaperImage = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete(STORE, id);
};
