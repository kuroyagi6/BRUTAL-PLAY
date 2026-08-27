import React from 'react';
import type { VideoItem } from '../types';
import * as videoDb from '../services/videoDb';

// Owns the video library: the imported video list, its IndexedDB persistence,
// import and de-duplication. It knows nothing about audio playback OR the audio
// library — it is the video-side twin of useMediaLibrary, kept in its own hook
// so the two can never interfere. The <video> player composes reads from here;
// App composes the whole thing without touching the audio engine.

const makeId = () => Math.random().toString(36).substr(2, 9);

/** local-media:/// URL a native path streams through (same scheme audio uses). */
const urlForPath = (nativePath: string) => `local-media:///${nativePath.replace(/\\/g, '/')}`;

export interface VideoLibrary {
  videos: VideoItem[];
  videoUsage: number;
  /** Import native video paths (from the folder picker). Returns a tally. */
  addNativeVideos: (paths: string[]) => Promise<{ added: number; skipped: number }>;
  removeVideo: (id: string) => Promise<void>;
  /** Remove every video at or beneath a folder (delete-from-desktop). */
  removeVideosUnder: (folderPath: string) => Promise<void>;
  /** Fold in duration/dimensions learned from the <video> element on first play. */
  noteVideoMeta: (id: string, meta: { duration?: number; width?: number; height?: number }) => void;
}

export function useVideoLibrary(): VideoLibrary {
  const [videos, setVideos] = React.useState<VideoItem[]>([]);
  // Derived, so it can never drift from the list (no manual increment/decrement).
  const videoUsage = React.useMemo(() => videoDb.videoUsageOf(videos), [videos]);

  // Load the persisted video library once on mount.
  React.useEffect(() => {
    (async () => {
      try {
        const stored = await videoDb.getAllVideos();
        if (stored.length > 0) {
          setVideos(
            stored.map((v) => ({
              id: v.id,
              name: v.name,
              url: urlForPath(v.nativePath),
              nativePath: v.nativePath,
              duration: v.duration,
              width: v.width,
              height: v.height,
              size: v.size,
            }))
          );
        }
      } catch (e) {
        console.error('Failed to load videos from IndexedDB:', e);
      }
    })();
  }, []);

  const addNativeVideos = async (paths: string[]): Promise<{ added: number; skipped: number }> => {
    // De-dupe against the library and within the batch (Windows: case-insensitive).
    const existing = new Set(videos.map((v) => v.nativePath.toLowerCase()));
    const fresh: string[] = [];
    let skipped = 0;
    for (const p of paths) {
      const k = p.toLowerCase();
      if (existing.has(k)) {
        skipped++;
        continue;
      }
      existing.add(k);
      fresh.push(p);
    }
    if (fresh.length === 0) return { added: 0, skipped };

    const newVideos: VideoItem[] = fresh.map((p) => ({
      id: makeId(),
      name: p.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Unknown',
      url: urlForPath(p),
      nativePath: p,
    }));

    // Persist best-effort — a dead DB must not drop the video from the session.
    try {
      await videoDb.saveVideos(newVideos);
    } catch (e) {
      console.error('Could not persist imported videos (they still play this session):', e);
    }

    setVideos((prev) => [...prev, ...newVideos]);
    return { added: newVideos.length, skipped };
  };

  const removeVideo = async (id: string) => {
    try {
      await videoDb.deleteVideo(id);
    } catch (e) {
      console.error('Failed to delete video from IndexedDB:', e);
    }
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };

  const removeVideosUnder = async (folderPath: string) => {
    const target = folderPath.toLowerCase().replace(/[\\/]+$/, '');
    const toRemove = videos.filter((v) => {
      const p = v.nativePath.toLowerCase();
      return p === target || p.startsWith(target + '\\') || p.startsWith(target + '/');
    });
    await Promise.all(toRemove.map((v) => removeVideo(v.id)));
  };

  // Persist learned metadata without forcing a re-render churn: patch the row and
  // update state only when a value actually changed.
  const noteVideoMeta = (id: string, meta: { duration?: number; width?: number; height?: number }) => {
    setVideos((prev) => {
      const idx = prev.findIndex((v) => v.id === id);
      if (idx === -1) return prev;
      const cur = prev[idx];
      if (cur.duration === meta.duration && cur.width === meta.width && cur.height === meta.height) {
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...cur, ...meta };
      videoDb.updateVideo(id, meta).catch(() => { /* best-effort */ });
      return next;
    });
  };

  return { videos, videoUsage, addNativeVideos, removeVideo, removeVideosUnder, noteVideoMeta };
}
