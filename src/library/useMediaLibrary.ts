import React from 'react';
import * as dbService from '../services/dbService';
import { usePersistentState } from '../hooks/usePersistentState';
import type { Track, Playlist } from '../types';
import type { ParsedMeta, ScannedMeta } from '../audio/trackMetadata';
import { parseFromBlob, parseFromUrl, applyMeta, fromScan } from '../audio/trackMetadata';
import { acquireCover, releaseCover } from './coverCache';
import {
  addWire as addWireEdge,
  removeWire as removeWireEdge,
  removeNode as removeNodeEdges,
  type Wire,
  type NodeRef,
} from '../audio/wires';

// Owns the music library: the track list, user playlists, disk usage, IndexedDB
// persistence, importing and de-duplication. It knows nothing about playback
// (no current track, no play/pause) — the player composes this and reconciles
// the current selection by track id when the list changes. Keeping this seam
// clean means new library features never touch the audio engine.

const makeId = () => Math.random().toString(36).substr(2, 9);

/** Progress for a folder import, so the UI can count rather than just spin. */
export interface ImportProgress {
  phase: 'scanning' | 'saving';
  done: number;
  total: number;
}

interface ImportBridge {
  scanMetadata?: (paths: string[]) => Promise<ScannedMeta[]>;
  onImportProgress?: (cb: (p: { done: number; total: number }) => void) => () => void;
}

/**
 * How many files are scanned before their tags are handed back for persistence.
 *
 * Scanning the whole folder in one IPC call meant every cover image in the
 * library — ~280 KB each — sat live in the main process AND in the structured
 * clone crossing to the renderer before a single row was written. Peak memory
 * grew with library size and a few thousand songs would spike past a gigabyte.
 * Chunking bounds that peak at ~CHUNK covers regardless of folder size, and
 * costs no speed because the main-process pool still saturates the cores within
 * a chunk.
 */
const IMPORT_CHUNK_SIZE = 25;

/** Shared, refcounted URL for a cover already in the DB. */
const coverUrlFor = (hash: string | undefined, covers: Map<string, Blob>): string | undefined => {
  if (!hash) return undefined;
  const blob = covers.get(hash);
  return blob ? acquireCover(hash, () => blob) : undefined;
};

const blobUrlFor = (blob: Blob | undefined): string | undefined =>
  blob ? URL.createObjectURL(blob) : undefined;

/**
 * Cover URL strategy for freshly parsed tracks: share by hash when the native
 * scan gave us one, otherwise mint a private URL (browser uploads).
 */
const sharedCoverUrl = (meta: ParsedMeta): string | undefined => {
  if (meta.coverHash && meta.coverBlob) {
    const blob = meta.coverBlob;
    return acquireCover(meta.coverHash, () => blob);
  }
  return blobUrlFor(meta.coverBlob);
};

/** Release whatever a track holds: a shared cover ref, or its own object URL. */
const releaseTrackCover = (track: Track): void => {
  if (track.coverHash) releaseCover(track.coverHash);
  else if (track.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(track.coverUrl);
};

const toMeta = (entry: ScannedMeta): ParsedMeta | null => {
  if (!entry || entry.error) {
    if (entry?.error) console.warn(`Metadata parse failed for "${entry.path}":`, entry.error);
    return null;
  }
  return fromScan(entry);
};

/**
 * Scan `paths` in chunks, invoking `onChunk` with each chunk's tags (one entry
 * per path, null where nothing was readable) before the next chunk is scanned.
 * Awaiting `onChunk` is what releases the previous chunk's cover bytes.
 */
async function scanInChunks(
  paths: string[],
  onChunk: (chunkPaths: string[], metas: (ParsedMeta | null)[]) => Promise<void>,
  onProgress?: (p: ImportProgress) => void
): Promise<void> {
  const api = (window as any).electronAPI as ImportBridge | undefined;
  const total = paths.length;
  let processed = 0;

  // Main reports progress within the current chunk; offset it into the batch.
  const unsubscribe = api?.scanMetadata
    ? api.onImportProgress?.(({ done }) =>
        onProgress?.({ phase: 'scanning', done: processed + done, total })
      )
    : undefined;

  try {
    for (let i = 0; i < total; i += IMPORT_CHUNK_SIZE) {
      const chunk = paths.slice(i, i + IMPORT_CHUNK_SIZE);
      let metas: (ParsedMeta | null)[];

      if (api?.scanMetadata) {
        metas = (await api.scanMetadata(chunk)).map(toMeta);
      } else {
        // Fallback: parse one file at a time through the local-media protocol.
        metas = [];
        for (const [j, p] of chunk.entries()) {
          try {
            metas.push(await parseFromUrl(`local-media:///${p.replace(/\\/g, '/')}`));
          } catch (error) {
            console.warn(`Metadata parse failed for "${p}", using filename only:`, error);
            metas.push(null);
          }
          onProgress?.({ phase: 'scanning', done: processed + j + 1, total });
        }
      }

      onProgress?.({ phase: 'saving', done: processed, total });
      await onChunk(chunk, metas);
      processed += chunk.length;
      onProgress?.({ phase: 'scanning', done: processed, total });
    }
  } finally {
    unsubscribe?.();
  }
}

export interface MediaLibrary {
  playlist: Track[];
  userPlaylists: Playlist[];
  diskUsage: number;
  addFiles: (files: FileList) => Promise<void>;
  addNativeFiles: (
    paths: string[],
    onProgress?: (p: ImportProgress) => void
  ) => Promise<{ added: number; skipped: number; persistFailed: number }>;
  removeTrack: (id: string) => Promise<void>;
  removeDuplicates: (currentId: string | null) => Promise<number>;
  updateTrackDetails: (id: string, updates: Partial<Track>) => Promise<void>;
  createPlaylist: (name: string) => Promise<string>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  // Wire graph linking desktop objects for end-to-end playback. Owned here as
  // data; the player reads it. See src/audio/wires.ts.
  wires: Wire[];
  addWire: (from: NodeRef, to: NodeRef) => Promise<void>;
  removeWire: (from: NodeRef, to: NodeRef) => Promise<void>;
  removeNodeWires: (node: NodeRef) => Promise<void>;
  // Per-subfolder link switches (see folderTree's IsLinked): the LOWERCASED
  // paths whose switch is OFF. Absent = linked, so everything participates in
  // wired playback until the user switches a subfolder off.
  unlinkedFolders: string[];
  toggleFolderLink: (path: string) => void;
}

export function useMediaLibrary(): MediaLibrary {
  const [playlist, setPlaylist] = React.useState<Track[]>([]);
  const [userPlaylists, setUserPlaylists] = React.useState<Playlist[]>([]);
  const [wires, setWires] = React.useState<Wire[]>([]);
  const [diskUsage, setDiskUsage] = React.useState(0);
  // Link switches live in localStorage like icon positions — a UI-level toggle,
  // not library rows, so no IndexedDB migration. Stored lowercased (Windows
  // paths compare case-insensitively, same as folderTree's `key`).
  const [unlinkedFolders, setUnlinkedFolders] = usePersistentState<string[]>('brutal-unlinked-folders', []);

  const toggleFolderLink = React.useCallback(
    (path: string) => {
      const k = path.toLowerCase();
      setUnlinkedFolders((prev) => (prev.includes(k) ? prev.filter((p) => p !== k) : [...prev, k]));
    },
    [setUnlinkedFolders]
  );

  const refreshDiskUsage = React.useCallback(async () => {
    try {
      setDiskUsage(await dbService.getDiskUsage());
    } catch (e) {
      console.warn('Could not read disk usage:', e);
    }
  }, []);

  // Load the persisted library once on mount.
  React.useEffect(() => {
    (async () => {
      try {
        const [storedTracks, covers] = await Promise.all([
          dbService.getAllTracks(),
          dbService.getAllCovers(),
        ]);
        if (storedTracks.length > 0) {
          const tracksWithUrls: Track[] = storedTracks.map((st) => ({
            id: st.id,
            name: st.name,
            artist: st.artist,
            album: st.album,
            url: st.nativePath
              ? `local-media:///${st.nativePath.replace(/\\/g, '/')}`
              : URL.createObjectURL(st.blob!),
            // Shared art resolves through the refcounted cache; legacy rows that
            // still embed their own blob keep an unshared URL.
            coverUrl: coverUrlFor(st.coverHash, covers) ?? blobUrlFor(st.coverBlob),
            coverHash: st.coverHash,
            bitrate: st.bitrate,
            sampleRate: st.sampleRate,
            codec: st.codec,
            duration: st.duration,
            lyrics: st.lyrics,
            syncedLyrics: st.syncedLyrics,
            genre: st.genre,
            nativePath: st.nativePath,
            explicit: st.explicit,
          }));
          setPlaylist(tracksWithUrls);
        }
        setUserPlaylists(await dbService.getAllPlaylists());
        setWires(await dbService.getWires());
        // Disk usage is a function of what we just loaded — compute it from the
        // tracks and covers already in hand rather than re-reading the whole DB
        // (getDiskUsage re-scans every track row and every cover blob a second
        // time, doubling startup I/O on large libraries).
        setDiskUsage(dbService.diskUsageOf(storedTracks, covers.values()));
      } catch (error) {
        console.error('Failed to load tracks or playlists from IndexedDB:', error);
      }
    })();
  }, [refreshDiskUsage]);

  const addFiles = async (files: FileList) => {
    const newTracks: Track[] = [];

    for (const file of Array.from(files)) {
      const fallbackName = file.name.replace(/\.[^/.]+$/, '');
      const track: Track = {
        id: makeId(),
        name: fallbackName,
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        url: URL.createObjectURL(file),
        genre: 'Unknown Genre',
      };

      // Metadata is best-effort — on failure we keep the filename fallback.
      let coverBlob: Blob | undefined;
      try {
        const meta = await parseFromBlob(file);
        coverBlob = meta.coverBlob;
        applyMeta(track, meta, fallbackName);
      } catch (error) {
        console.warn('Metadata parse failed, using filename only:', error);
      }

      // Persist best-effort: a DB failure must not drop the track from the session.
      try {
        await dbService.saveTrack(track, file, coverBlob);
      } catch (dbErr) {
        console.error(`Could not persist "${track.name}" (will still play this session):`, dbErr);
      }
      newTracks.push(track);
    }

    if (newTracks.length > 0) {
      setPlaylist((prev) => [...prev, ...newTracks]);
      await refreshDiskUsage();
    }
  };

  const addNativeFiles = async (
    paths: string[],
    onProgress?: (p: ImportProgress) => void
  ): Promise<{ added: number; skipped: number; persistFailed: number }> => {
    // ── Stage 1: de-dupe before doing any I/O ──
    // Skip files already in the library (and repeats within this batch).
    // Windows paths are case-insensitive.
    const existingPaths = new Set(
      playlist.map((t) => t.nativePath?.toLowerCase()).filter(Boolean) as string[]
    );
    const fresh: string[] = [];
    let skipped = 0;

    for (const p of paths) {
      const pathKey = p.toLowerCase();
      if (existingPaths.has(pathKey)) {
        skipped++;
        continue;
      }
      existingPaths.add(pathKey);
      fresh.push(p);
    }
    if (fresh.length === 0) return { added: 0, skipped, persistFailed: 0 };

    // ── Stage 2: scan + persist, one bounded chunk at a time ──
    // Each chunk is written and appended to the visible library before the next
    // is scanned, so cover bytes never accumulate and tracks show up as they land.
    let added = 0;
    let persistFailed = 0;

    await scanInChunks(
      fresh,
      async (chunkPaths, metas) => {
        const tracks = chunkPaths.map((p, i) => {
          const fileName = p.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown';
          const track: Track = {
            id: makeId(),
            name: fileName,
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            url: `local-media:///${p.replace(/\\/g, '/')}`,
            genre: 'Unknown Genre',
            nativePath: p,
          };
          const meta = metas[i];
          if (meta) applyMeta(track, meta, fileName, sharedCoverUrl);
          return track;
        });

        // Persistence is best effort — a dead DB must not lose the track.
        try {
          const failedIds = await dbService.saveTracks(
            tracks.map((track, i) => ({
              track,
              coverBlob: metas[i]?.coverBlob,
              nativePath: chunkPaths[i],
            }))
          );
          persistFailed += failedIds.length;
        } catch (error) {
          console.error('Could not persist a chunk of imported tracks (they still play this session):', error);
          persistFailed += tracks.length;
        }

        added += tracks.length;
        setPlaylist((prev) => [...prev, ...tracks]);
      },
      onProgress
    );

    await refreshDiskUsage();
    return { added, skipped, persistFailed };
  };

  const removeTrack = async (id: string) => {
    const trackToRemove = playlist.find((t) => t.id === id);
    if (!trackToRemove) return;

    if (trackToRemove.url.startsWith('blob:')) URL.revokeObjectURL(trackToRemove.url);
    releaseTrackCover(trackToRemove);

    try {
      await dbService.deleteTrack(id);
    } catch (error) {
      console.error('Failed to delete track from IndexedDB:', error);
    }

    setPlaylist((prev) => prev.filter((t) => t.id !== id));
    await refreshDiskUsage();
  };

  // Remove duplicate library entries. Native tracks match by filename, uploaded
  // tracks by metadata. Keeps the best copy of each group (prefers the currently
  // playing one — passed in as currentId — then cover art and duration).
  const removeDuplicates = async (currentId: string | null): Promise<number> => {
    const keyOf = (t: Track) => {
      if (t.nativePath) {
        const base = t.nativePath.split(/[\\/]/).pop() || t.nativePath;
        return 'path:' + base.toLowerCase();
      }
      return `meta:${t.name}|${t.artist}|${t.album}|${Math.round(t.duration || 0)}`.toLowerCase();
    };
    const score = (t: Track) =>
      (t.id === currentId ? 10 : 0) + (t.coverUrl ? 2 : 0) + (t.duration ? 1 : 0);

    const kept = new Map<string, Track>();
    const toRemove: Track[] = [];
    for (const t of playlist) {
      const k = keyOf(t);
      const existing = kept.get(k);
      if (!existing) {
        kept.set(k, t);
      } else if (score(t) > score(existing)) {
        toRemove.push(existing);
        kept.set(k, t);
      } else {
        toRemove.push(t);
      }
    }
    if (toRemove.length === 0) return 0;

    for (const t of toRemove) {
      try {
        await dbService.deleteTrack(t.id);
      } catch (e) {
        console.error('Failed to delete duplicate track:', e);
      }
      if (t.url.startsWith('blob:')) URL.revokeObjectURL(t.url);
      releaseTrackCover(t);
    }

    const removeIds = new Set(toRemove.map((t) => t.id));
    setPlaylist((prev) => prev.filter((t) => !removeIds.has(t.id)));
    await refreshDiskUsage();
    return toRemove.length;
  };

  const updateTrackDetails = async (id: string, updates: Partial<Track>) => {
    try {
      await dbService.updateTrack(id, updates);
      setPlaylist((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    } catch (e) {
      console.error('Failed to update track', e);
    }
  };

  // Returns the new playlist's id so callers (the desktop "+" tile) can open its
  // window immediately. Existing callers that ignore the return are unaffected.
  const createPlaylist = async (name: string): Promise<string> => {
    const newPlaylist: Playlist = { id: makeId(), name, trackIds: [], createdAt: Date.now() };
    await dbService.savePlaylist(newPlaylist);
    setUserPlaylists((prev) => [...prev, newPlaylist]);
    return newPlaylist.id;
  };

  const renamePlaylist = async (playlistId: string, name: string) => {
    const idx = userPlaylists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return;
    const updated = [...userPlaylists];
    const obj = { ...updated[idx], name };
    await dbService.savePlaylist(obj);
    updated[idx] = obj;
    setUserPlaylists(updated);
  };

  const addTrackToPlaylist = async (playlistId: string, trackId: string) => {
    const idx = userPlaylists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return;
    const updated = [...userPlaylists];
    const obj = { ...updated[idx] };
    if (!obj.trackIds.includes(trackId)) {
      obj.trackIds = [...obj.trackIds, trackId];
      await dbService.savePlaylist(obj);
      updated[idx] = obj;
      setUserPlaylists(updated);
    }
  };

  const removeTrackFromPlaylist = async (playlistId: string, trackId: string) => {
    const idx = userPlaylists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return;
    const updated = [...userPlaylists];
    const obj = { ...updated[idx] };
    obj.trackIds = obj.trackIds.filter((tid) => tid !== trackId);
    await dbService.savePlaylist(obj);
    updated[idx] = obj;
    setUserPlaylists(updated);
  };

  const deletePlaylist = async (playlistId: string) => {
    await dbService.deletePlaylist(playlistId);
    setUserPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
    // Drop any wire that referenced this playlist so no wire dangles.
    await removeNodeWires({ kind: 'playlist', key: playlistId });
  };

  // All wire mutations go through the pure helpers in audio/wires.ts, then
  // persist the whole (small) graph. State and disk stay in lockstep.
  const persistWires = async (next: Wire[]) => {
    setWires(next);
    await dbService.saveWires(next);
  };

  const addWire = async (from: NodeRef, to: NodeRef) => {
    await persistWires(addWireEdge(wires, { from, to, type: 'continuous' }));
  };

  const removeWire = async (from: NodeRef, to: NodeRef) => {
    await persistWires(removeWireEdge(wires, from, to));
  };

  const removeNodeWires = async (node: NodeRef) => {
    const next = removeNodeEdges(wires, node);
    if (next.length !== wires.length) await persistWires(next);
  };

  return {
    playlist,
    userPlaylists,
    diskUsage,
    addFiles,
    addNativeFiles,
    removeTrack,
    removeDuplicates,
    updateTrackDetails,
    createPlaylist,
    renamePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    wires,
    addWire,
    removeWire,
    removeNodeWires,
    unlinkedFolders,
    toggleFolderLink,
  };
}
