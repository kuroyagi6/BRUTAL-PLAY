import React from 'react';
import { usePersistentState } from './usePersistentState';
import type { YouTubeItem } from '../types';
import { parseYouTube } from '../utils/youtube';
import { nextNode, type NodeRef, type Wire } from '../audio/wires';
import type { WinRuntime } from './useWindowManager';

// EXPERIMENTAL YouTube layer. A parallel stack like the [[video-layer]] and the
// radio [[useStations]] hook: it owns a saved list of YouTube targets (a single
// video or a whole playlist) and drives ONE embedded-player window. The audio
// plays inside YouTube's cross-origin iframe, so it never touches useAudioPlayer,
// the queue, the EQ/crossfade graph, or the wire graph — that isolation is a hard
// browser boundary, not a choice. The only coupling lives at the App seam:
// opening a YouTube item pauses the music engine so they don't play over one
// another (one-directional, matching the video layer).

/** Fixed id of the single YouTube player window (one plays at a time). */
export const YOUTUBE_PLAYER_ID = 'youtube-player';

const STORAGE_KEY = 'brutal-youtube';

let idCounter = 0;
const newId = () => `yt_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export interface YouTubeApi {
  items: YouTubeItem[];
  /** Parse a pasted URL/id and save it. Returns true if it was a valid target. */
  addYouTube: (name: string, urlOrId: string) => boolean;
  removeYouTube: (id: string) => void;
  renameYouTube: (id: string, name: string) => void;
  /** The item currently loaded in the player window, or null. */
  currentItem: YouTubeItem | null;
  /** Open the player window on an item (pauses the music engine). */
  playYouTube: (id: string) => void;
  /** Close the player window and unload the iframe. */
  closePlayer: () => void;
  /** Called by the player window the moment playback begins. */
  pauseMusicForYouTube: () => void;
  /** Called by the player window when the video/playlist fully finishes: follow
   *  any wire off this node (into another youtube item, or back to a folder/
   *  playlist/video via the audio engine). */
  onYouTubeEnded: () => void;
  resetYouTube: () => void;
}

interface YouTubeDeps {
  /** From useWindowManager — the player window registers/unregisters through it. */
  setWinState: React.Dispatch<React.SetStateAction<Record<string, WinRuntime>>>;
  /** The one seam with the audio engine, read live via the render closure. */
  isPlaying: boolean;
  togglePlay: () => void;
  // Wire graph seam (owned by the audio engine / library).
  wires: Wire[];
  /** Register the handler the engine calls to hand a wire INTO a youtube node. */
  setYouTubeWireHandler: (fn: ((node: NodeRef) => boolean) | null) => void;
  /** Resume the audio engine at a wired folder/playlist (or a video via its own
   *  handler) when a youtube item hands the chain onward. */
  playWireNode: (node: NodeRef) => void;
  /** Drop every wire touching a node when its item is removed. */
  removeNodeWires: (node: NodeRef) => void;
}

/** A youtube item's stable wire-graph node. */
const youtubeNodeOf = (id: string): NodeRef => ({ kind: 'youtube', key: id });

export function useYouTube(deps: YouTubeDeps): YouTubeApi {
  const { setWinState, isPlaying, togglePlay, wires, setYouTubeWireHandler, playWireNode, removeNodeWires } = deps;
  const [items, setItems] = usePersistentState<YouTubeItem[]>(STORAGE_KEY, []);
  const [currentId, setCurrentId] = React.useState<string | null>(null);

  // When a youtube item plays as part of a wire chain (or was double-clicked),
  // this holds its node so the item's end can follow the wire onward. Kept in a
  // ref because the player window's onEnded fires from an async iframe event.
  const chainNodeRef = React.useRef<NodeRef | null>(null);
  // Latest wires for the async onEnded callback (avoids a stale closure).
  const wiresRef = React.useRef(wires);
  wiresRef.current = wires;

  const addYouTube = React.useCallback(
    (name: string, urlOrId: string) => {
      const parsed = parseYouTube(urlOrId);
      if (!parsed) return false;
      const item: YouTubeItem = {
        id: newId(),
        name: name.trim() || (parsed.kind === 'playlist' ? 'PLAYLIST' : 'VIDEO'),
        kind: parsed.kind,
        ytId: parsed.ytId,
        createdAt: Date.now(),
      };
      setItems((prev) => [...prev, item]);
      return true;
    },
    [setItems]
  );

  const closePlayer = React.useCallback(() => {
    chainNodeRef.current = null;
    setCurrentId(null);
    setWinState((s) => {
      const { [YOUTUBE_PLAYER_ID]: _closed, ...rest } = s;
      return rest;
    });
  }, [setWinState]);

  const removeYouTube = React.useCallback(
    (id: string) => {
      setCurrentId((cur) => {
        if (cur === id) {
          chainNodeRef.current = null;
          setWinState((s) => {
            const { [YOUTUBE_PLAYER_ID]: _closed, ...rest } = s;
            return rest;
          });
          return null;
        }
        return cur;
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
      removeNodeWires(youtubeNodeOf(id)); // drop any patch cables to this node
    },
    [setItems, setWinState, removeNodeWires]
  );

  const renameYouTube = React.useCallback(
    (id: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name: n } : i)));
    },
    [setItems]
  );

  // Load an item into the player window and mark it as the live chain node so its
  // end can follow any wire onward. Shared by the double-click path and the wire
  // handoff below.
  const showItem = React.useCallback(
    (id: string) => {
      setCurrentId(id);
      chainNodeRef.current = youtubeNodeOf(id);
      setWinState((s) => ({ ...s, [YOUTUBE_PLAYER_ID]: { open: true, minimized: false } }));
    },
    [setWinState]
  );

  const playYouTube = React.useCallback((id: string) => showItem(id), [showItem]);

  // Wire handoff INTO a youtube node (the engine calls this). Returns false if the
  // node has no matching item, so the engine can fall through to its normal wrap.
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const playYouTubeNode = React.useCallback(
    (node: NodeRef): boolean => {
      if (!itemsRef.current.some((i) => i.id === node.key)) return false;
      showItem(node.key);
      return true;
    },
    [showItem]
  );

  // Register the handler so a wire INTO a youtube node reaches this layer.
  React.useEffect(() => {
    setYouTubeWireHandler(playYouTubeNode);
    return () => setYouTubeWireHandler(null);
  }, [setYouTubeWireHandler, playYouTubeNode]);

  // The item finished: follow the wire off its node. Into another youtube item →
  // play it here; into a folder/playlist/video → close the player and hand back
  // to the audio engine (playWireNode routes video via its own handler too).
  const onYouTubeEnded = React.useCallback(() => {
    const chain = chainNodeRef.current;
    chainNodeRef.current = null;
    const nxt = chain ? nextNode(wiresRef.current, chain) : null;
    if (!nxt) return; // one-off item, or end of the chain: just stop
    if (nxt.kind === 'youtube') {
      playYouTubeNode(nxt);
    } else {
      closePlayer();
      playWireNode(nxt);
    }
  }, [playYouTubeNode, closePlayer, playWireNode]);

  // Opening a YouTube item pauses the music so the two don't overlap. Reads the
  // live audio state through the render closure (same pattern as the video layer).
  const pauseMusicForYouTube = React.useCallback(() => {
    if (isPlaying) togglePlay();
  }, [isPlaying, togglePlay]);

  const currentItem = React.useMemo(
    () => items.find((i) => i.id === currentId) ?? null,
    [items, currentId]
  );

  const resetYouTube = React.useCallback(() => {
    setCurrentId(null);
  }, []);

  return {
    items,
    addYouTube,
    removeYouTube,
    renameYouTube,
    currentItem,
    playYouTube,
    closePlayer,
    pauseMusicForYouTube,
    onYouTubeEnded,
    resetYouTube,
  };
}
