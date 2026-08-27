import React from 'react';
import type { VideoItem } from '../types';
import type { FolderEntry } from '../library/folderTree';
import { rootFolders, samePath, dirOf, isUnder, tracksUnderOrdered } from '../library/folderTree';
import { nextNode, type NodeRef, type Wire } from '../audio/wires';
import type { WinRuntime } from './useWindowManager';

/** Fixed id of the single video-player window (only one clip plays at a time). */
export const VIDEO_PLAYER_ID = 'video-player';

interface VideoDeps {
  /** From useWindowManager — dynamic windows register/unregister through it. */
  setWinState: React.Dispatch<React.SetStateAction<Record<string, WinRuntime>>>;
  // Video library.
  videos: VideoItem[];
  removeVideosUnder: (folderPath: string) => Promise<void>;
  // For desktop icons: a video root is offline when its path is unreachable.
  missingPaths: Set<string>;
  // Wire seam (audio engine).
  wires: Wire[];
  playWireNode: (node: NodeRef) => void;
  setVideoWireHandler: (fn: ((node: NodeRef) => boolean) | null) => void;
  // The one place the two engines meet: starting a video pauses the music.
  isPlaying: boolean;
  togglePlay: () => void;
}

/**
 * The video layer's windows — one explorer window per imported video root plus a
 * single video-player window — and the wire/chain playback that stitches them to
 * the audio side. A clip's end advances within its folder, then follows any wire
 * off the folder: into the next video root, or back to the music engine
 * (`playWireNode`). The engine can also hand a wire *into* a video via the
 * registered `setVideoWireHandler`. Parallel to the audio queue; none of this
 * goes through it. See src/audio/wires.ts and the [[video-layer]] notes.
 */
export function useVideoWindows(deps: VideoDeps) {
  const {
    setWinState, videos, removeVideosUnder, missingPaths,
    wires, playWireNode, setVideoWireHandler, isPlaying, togglePlay,
  } = deps;

  const [openVideoFolders, setOpenVideoFolders] = React.useState<string[]>([]);
  const videoFolderWinId = (path: string) => `video:${path}`;
  const [currentVideo, setCurrentVideo] = React.useState<VideoItem | null>(null);
  const [videoPlaying, setVideoPlaying] = React.useState(false);
  // When a video is being played as part of a wire chain (or a folder started
  // from a clip), this tracks which video root and how far through it we are, so
  // the clip's end can advance within the folder and then follow the wire onward.
  // null = a one-off clip that just stops when it ends.
  const videoChainRef = React.useRef<{ node: NodeRef; index: number } | null>(null);

  // One desktop icon per imported video root (subfolders live inside the window),
  // derived the same way as music folders — the tree math is shared and generic.
  const desktopVideos = React.useMemo(
    () => rootFolders(videos, (p) => missingPaths.has(p.toLowerCase())),
    [videos, missingPaths]
  );

  const openVideoFolder = (folderPath: string) => {
    setOpenVideoFolders((prev) => (prev.some((p) => samePath(p, folderPath)) ? prev : [...prev, folderPath]));
    setWinState((s) => ({ ...s, [videoFolderWinId(folderPath)]: { open: true, minimized: false } }));
  };

  const closeVideoFolder = (folderPath: string) => {
    setOpenVideoFolders((prev) => prev.filter((p) => !samePath(p, folderPath)));
    setWinState((s) => {
      const { [videoFolderWinId(folderPath)]: _closed, ...rest } = s;
      return rest;
    });
  };

  // Load a clip into the (single) video-player window and show it. Pure display;
  // the chain bookkeeping is set by the callers below.
  const showClip = (clip: VideoItem) => {
    setCurrentVideo(clip);
    setWinState((s) => ({ ...s, [VIDEO_PLAYER_ID]: { open: true, minimized: false } }));
  };

  // Which video root (desktop icon / wire node) a clip belongs to.
  const videoNodeOf = (clip: VideoItem): NodeRef | null => {
    const root = desktopVideos.find(
      (f) => samePath(dirOf(clip.nativePath), f.path) || isUnder(clip.nativePath, f.path)
    );
    return root ? { kind: 'video', key: root.path } : null;
  };

  // Double-click a clip: play its whole folder from that clip onward, then follow
  // any wire off the folder. (A clip with no resolvable root just plays alone.)
  const openVideo = (clip: VideoItem) => {
    const node = videoNodeOf(clip);
    if (node) {
      const clips = tracksUnderOrdered<VideoItem>(videos, node.key);
      videoChainRef.current = { node, index: Math.max(0, clips.findIndex((c) => c.id === clip.id)) };
    } else {
      videoChainRef.current = null;
    }
    showClip(clip);
  };

  // Wire handoff INTO a video root: play the whole folder from the top. Returns
  // false if the root has no clips (so the audio engine can stop instead). The
  // engine pauses the music when this returns true (its existing behaviour).
  const playVideoNode = (node: NodeRef): boolean => {
    const clips = tracksUnderOrdered<VideoItem>(videos, node.key);
    if (clips.length === 0) return false;
    videoChainRef.current = { node, index: 0 };
    showClip(clips[0]);
    return true;
  };

  // A clip finished: advance within the folder, else follow the wire onward —
  // into the next video, or hand back to the music engine for a folder/playlist.
  const onVideoEnded = () => {
    const chain = videoChainRef.current;
    if (!chain) return; // one-off clip: just stop
    const clips = tracksUnderOrdered<VideoItem>(videos, chain.node.key);
    const nextIdx = chain.index + 1;
    if (nextIdx < clips.length) {
      videoChainRef.current = { node: chain.node, index: nextIdx };
      showClip(clips[nextIdx]);
      return;
    }
    const nxt = nextNode(wires, chain.node);
    videoChainRef.current = null;
    if (!nxt) return; // end of the chain
    if (nxt.kind === 'video') {
      playVideoNode(nxt);
    } else {
      closeVideoPlayer(); // stop the video and give the screen back
      playWireNode(nxt); // resume the music at the wired folder/playlist
    }
  };

  // Let the audio engine hand a wire off into a video (seam A). Re-registered
  // when the video library changes so it always sees the current clips.
  React.useEffect(() => {
    setVideoWireHandler(playVideoNode);
    return () => setVideoWireHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, desktopVideos]);

  const closeVideoPlayer = () => {
    setCurrentVideo(null);
    setVideoPlaying(false);
    videoChainRef.current = null;
    setWinState((s) => {
      const { [VIDEO_PLAYER_ID]: _closed, ...rest } = s;
      return rest;
    });
  };

  const deleteVideoFolderFromLibrary = async (folderPath: string) => {
    // If the playing clip lives under this folder, drop the player too.
    if (currentVideo && (samePath(dirOf(currentVideo.nativePath), folderPath) || isUnder(currentVideo.nativePath, folderPath))) {
      closeVideoPlayer();
    }
    await removeVideosUnder(folderPath);
  };

  // A video window whose root no longer has any videos (removed) is empty — close it.
  React.useEffect(() => {
    const live = new Set(desktopVideos.map((f) => f.path.toLowerCase()));
    const stale = openVideoFolders.filter((p) => !live.has(p.toLowerCase()) && !desktopVideos.some((f) => isUnder(p, f.path)));
    if (stale.length > 0) stale.forEach(closeVideoFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopVideos]);

  // The one place the two engines meet: starting a video pauses the music so they
  // don't play over each other. Reads the live audio state via the render closure.
  const pauseMusicForVideo = () => {
    if (isPlaying) togglePlay();
  };

  // Clear the open-list and player (used by the layout reset; winState is reset
  // separately by the window manager).
  const resetVideoWindows = () => {
    setOpenVideoFolders([]);
    setCurrentVideo(null);
  };

  return {
    desktopVideos,
    openVideoFolders,
    videoFolderWinId,
    currentVideo,
    videoPlaying,
    setVideoPlaying,
    openVideoFolder,
    closeVideoFolder,
    openVideo,
    onVideoEnded,
    closeVideoPlayer,
    deleteVideoFolderFromLibrary,
    pauseMusicForVideo,
    resetVideoWindows,
  };
}
