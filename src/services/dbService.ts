import { openDB, IDBPDatabase } from 'idb';
import type { Track, Playlist, ArtistProfile } from '../types';
import type { Wire } from '../audio/wires';
import type { StoredMeanings } from './geniusMeaning';

// Re-export so existing `import { Playlist } from '../services/dbService'` keeps working.
export type { Playlist } from '../types';

const DB_NAME = 'brutal-player-db';
const STORE_NAME = 'tracks';
const PLAYLISTS_STORE = 'playlists';
const COVERS_STORE = 'covers';
const WIRES_STORE = 'wires';
const ARTISTS_STORE = 'artists';
const MEANINGS_STORE = 'meanings';
const COVER_HASH_INDEX = 'coverHash';
// The whole wire graph is one small array, stored as a single row under this key.
const WIRES_KEY = 'graph';
const DB_VERSION = 6;

export interface StoredTrack extends Omit<Track, 'file' | 'url' | 'coverUrl'> {
  blob?: Blob;
  size?: number;
  /** Legacy (pre-v3): art embedded in the track row, one copy per track.
   *  Still read on load so old libraries keep their covers; never written now. */
  coverBlob?: Blob;
  /** v3+: key into the `covers` store. Tracks on an album share one entry. */
  coverHash?: string;
  genre?: string;
  nativePath?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
          db.createObjectStore(PLAYLISTS_STORE, { keyPath: 'id' });
        }
        // v3: covers keyed by content hash, out-of-line (the key is the hash).
        if (!db.objectStoreNames.contains(COVERS_STORE)) {
          db.createObjectStore(COVERS_STORE);
        }
        // Lets orphan collection ask "does any track still use this hash?"
        // without scanning the whole track store. Rows lacking coverHash simply
        // aren't in the index, which is what we want.
        const tracks = tx.objectStore(STORE_NAME);
        if (!tracks.indexNames.contains(COVER_HASH_INDEX)) {
          tracks.createIndex(COVER_HASH_INDEX, 'coverHash');
        }
        // v4: the wire graph, out-of-line (whole array under a single key).
        if (!db.objectStoreNames.contains(WIRES_STORE)) {
          db.createObjectStore(WIRES_STORE);
        }
        // v5: cached online artist profiles, keyed by lowercased artist name.
        if (!db.objectStoreNames.contains(ARTISTS_STORE)) {
          db.createObjectStore(ARTISTS_STORE, { keyPath: 'key' });
        }
        // v6: cached Genius lyric annotations, keyed by normalized artist|title.
        // This is what makes the MEANING corner work offline: a song is looked
        // up once, while there happens to be a connection, and read from here
        // forever after.
        if (!db.objectStoreNames.contains(MEANINGS_STORE)) {
          db.createObjectStore(MEANINGS_STORE, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
};

// Art with a hash goes to the shared `covers` store and the row keeps only the
// key. Art without one (browser uploads) stays embedded, as before.
const toStored = (
  track: Track,
  file?: File,
  coverBlob?: Blob,
  nativePath?: string
): StoredTrack => ({
  id: track.id,
  name: track.name,
  artist: track.artist,
  album: track.album,
  blob: file,
  size: file ? file.size : 0,
  coverBlob: track.coverHash ? undefined : coverBlob,
  coverHash: track.coverHash,
  nativePath,
  bitrate: track.bitrate,
  sampleRate: track.sampleRate,
  codec: track.codec,
  duration: track.duration,
  lyrics: track.lyrics,
  syncedLyrics: track.syncedLyrics,
  genre: track.genre,
  explicit: track.explicit,
});

export const saveTrack = async (track: Track, file?: File, coverBlob?: Blob, nativePath?: string) => {
  const db = await getDB();
  const tx = db.transaction([STORE_NAME, COVERS_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(STORE_NAME).put(toStored(track, file, coverBlob, nativePath)),
    track.coverHash && coverBlob
      ? tx.objectStore(COVERS_STORE).put(coverBlob, track.coverHash)
      : Promise.resolve(),
  ]);
  await tx.done;
};

/**
 * Persist many tracks in a single transaction. Importing a folder one `saveTrack`
 * at a time meant one IndexedDB transaction per song; batching them makes a
 * 250-track import a single commit. Returns the ids that failed to write, so a
 * partial failure still lets the caller keep the rest of the batch playable.
 */
export const saveTracks = async (
  entries: { track: Track; file?: File; coverBlob?: Blob; nativePath?: string }[]
): Promise<string[]> => {
  if (entries.length === 0) return [];
  const db = await getDB();
  const tx = db.transaction([STORE_NAME, COVERS_STORE], 'readwrite');
  const trackStore = tx.objectStore(STORE_NAME);
  const coverStore = tx.objectStore(COVERS_STORE);
  const failed: string[] = [];

  // One write per unique image, not per track: an album's tracks all carry the
  // same hash, and a cover already in the store needs no rewrite at all.
  const covers = new Map<string, Blob>();
  for (const { track, coverBlob } of entries) {
    if (track.coverHash && coverBlob && !covers.has(track.coverHash)) {
      covers.set(track.coverHash, coverBlob);
    }
  }

  await Promise.all([
    ...entries.map(({ track, file, coverBlob, nativePath }) =>
      trackStore.put(toStored(track, file, coverBlob, nativePath)).catch(() => {
        failed.push(track.id);
      })
    ),
    ...[...covers].map(async ([hash, blob]) => {
      if ((await coverStore.getKey(hash)) === undefined) await coverStore.put(blob, hash);
    }),
  ]);
  await tx.done;
  return failed;
};

export const getAllTracks = async (): Promise<StoredTrack[]> => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

/** Every stored cover, keyed by hash, for building shared object URLs on load. */
export const getAllCovers = async (): Promise<Map<string, Blob>> => {
  const db = await getDB();
  const tx = db.transaction(COVERS_STORE, 'readonly');
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  return new Map(keys.map((k, i) => [k as string, values[i] as Blob]));
};

/**
 * Delete a track, then drop its cover if no other track references it. Both in
 * one transaction, so a concurrent import can't add a reference between the
 * count and the delete.
 */
export const deleteTrack = async (id: string) => {
  const db = await getDB();
  const tx = db.transaction([STORE_NAME, COVERS_STORE], 'readwrite');
  const trackStore = tx.objectStore(STORE_NAME);

  const existing = (await trackStore.get(id)) as StoredTrack | undefined;
  await trackStore.delete(id);

  if (existing?.coverHash) {
    const stillUsed = await trackStore.index(COVER_HASH_INDEX).count(existing.coverHash);
    if (stillUsed === 0) await tx.objectStore(COVERS_STORE).delete(existing.coverHash);
  }
  await tx.done;
};

/**
 * Bytes occupied by a set of tracks and covers we already hold in memory:
 * uploaded audio blobs, legacy embedded art, plus each shared cover. Pure, so the
 * initial load can reuse the data it just read instead of scanning the DB again.
 */
export const diskUsageOf = (tracks: StoredTrack[], covers: Iterable<Blob>): number => {
  const trackBytes = tracks.reduce(
    (acc, t) => acc + (t.size || 0) + (t.coverBlob?.size || 0), // legacy embedded art
    0
  );
  let coverBytes = 0;
  for (const blob of covers) coverBytes += blob.size;
  return trackBytes + coverBytes;
};

/** Bytes we actually occupy: uploaded audio blobs plus every stored cover. */
export const getDiskUsage = async (): Promise<number> => {
  const db = await getDB();
  const [tracks, covers] = await Promise.all([
    db.getAll(STORE_NAME) as Promise<StoredTrack[]>,
    db.getAll(COVERS_STORE) as Promise<Blob[]>,
  ]);
  return diskUsageOf(tracks, covers);
};

export const savePlaylist = async (playlist: Playlist) => {
  const db = await getDB();
  await db.put(PLAYLISTS_STORE, playlist);
};

export const getAllPlaylists = async (): Promise<Playlist[]> => {
  const db = await getDB();
  return db.getAll(PLAYLISTS_STORE);
};

export const deletePlaylist = async (id: string) => {
  const db = await getDB();
  await db.delete(PLAYLISTS_STORE, id);
};

// The wire graph is small and read/written whole — one row, not one per edge.
export const saveWires = async (wires: Wire[]) => {
  const db = await getDB();
  await db.put(WIRES_STORE, wires, WIRES_KEY);
};

export const getWires = async (): Promise<Wire[]> => {
  const db = await getDB();
  return (await db.get(WIRES_STORE, WIRES_KEY)) ?? [];
};

// --- Online artist profiles (cache) ---
// Looked up per unique artist name and cached whole; the store is tiny (text +
// a remote image URL, no blobs), so it is read/written one row at a time.
/**
 * Fires after any profile write. Readers holding a bulk snapshot of the store
 * (Spotlight's avatar map) listen for this and re-read, so a photo appears as
 * soon as the prefetch resolves it instead of on the next app start.
 */
export const ARTIST_PROFILES_CHANGED = 'brutal-artistProfiles-changed';

export const saveArtistProfile = async (profile: ArtistProfile) => {
  const db = await getDB();
  await db.put(ARTISTS_STORE, profile);
  // Notify from the writer so every path (single lookup, refetch, prefetch)
  // announces itself without each caller having to remember to.
  try {
    window.dispatchEvent(new Event(ARTIST_PROFILES_CHANGED));
  } catch {
    /* no window (tests/node) — nothing is listening anyway. */
  }
};

export const getArtistProfile = async (key: string): Promise<ArtistProfile | undefined> => {
  const db = await getDB();
  return db.get(ARTISTS_STORE, key);
};

/**
 * Every cached profile in one read. For consumers that need to look up many
 * artists at once (Spotlight rendering an avatar per result) and must NOT hit
 * the network per keystroke — they read this once and match in memory. Safe to
 * pull whole: rows are small text + remote URLs, no blobs, one per unique
 * artist name.
 */
export const getAllArtistProfiles = async (): Promise<ArtistProfile[]> => {
  const db = await getDB();
  return db.getAll(ARTISTS_STORE);
};

/** Cached profile keys only — used to skip already-known artists in a prefetch. */
export const getArtistProfileKeys = async (): Promise<string[]> => {
  const db = await getDB();
  return (await db.getAllKeys(ARTISTS_STORE)) as string[];
};

// ─── Genius lyric annotations (the MEANING corner) ───────────────────────────
// Cached so the corner works with no connection: a song costs one lookup, ever.
// Rows are small plain text keyed by normalized artist|title — no blobs, and
// nothing here is ever read back as lyrics.

export const saveMeanings = async (row: StoredMeanings) => {
  const db = await getDB();
  await db.put(MEANINGS_STORE, row);
};

export const getMeanings = async (key: string): Promise<StoredMeanings | undefined> => {
  const db = await getDB();
  return db.get(MEANINGS_STORE, key);
};

export const deleteMeanings = async (key: string) => {
  const db = await getDB();
  await db.delete(MEANINGS_STORE, key);
};

/** How many songs have meanings cached, for the Settings/corner readout. */
export const countMeanings = async (): Promise<number> => {
  const db = await getDB();
  return db.count(MEANINGS_STORE);
};

export const clearMeanings = async () => {
  const db = await getDB();
  await db.clear(MEANINGS_STORE);
};

export const clearAllData = async () => {
  const db = await getDB();
  await db.clear(STORE_NAME);
  await db.clear(PLAYLISTS_STORE);
  await db.clear(COVERS_STORE);
  await db.clear(WIRES_STORE);
  await db.clear(ARTISTS_STORE);
  await db.clear(MEANINGS_STORE);
};

export const updateTrack = async (id: string, updates: Partial<StoredTrack>) => {
  const db = await getDB();
  const track = await db.get(STORE_NAME, id);
  if (track) {
    const updatedTrack = { ...track, ...updates };
    await db.put(STORE_NAME, updatedTrack);
  }
};

