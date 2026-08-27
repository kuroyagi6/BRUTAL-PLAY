import React from 'react';
import type { Track, Playlist } from '../types';
import type { FolderEntry } from '../library/folderTree';
import { samePath, dirOf, isUnder } from '../library/folderTree';
import type { View } from '../components/LibraryView';
import type { WinRuntime } from './useWindowManager';

interface ExplorerDeps {
  /** From useWindowManager — dynamic windows register/unregister through it. */
  setWinState: React.Dispatch<React.SetStateAction<Record<string, WinRuntime>>>;
  // Folder side.
  playlist: Track[];
  removeTrack: (id: string) => Promise<void>;
  desktopFolders: FolderEntry[];
  selectedFolder: string | null;
  setSelectedFolder: React.Dispatch<React.SetStateAction<string | null>>;
  setView: React.Dispatch<React.SetStateAction<View>>;
  // Playlist side.
  userPlaylists: Playlist[];
  createPlaylist: (name: string) => Promise<string>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
}

/**
 * The dynamic explorer windows — one per opened music-folder root and one per
 * opened playlist. Both share the window manager's `winState` (keyed
 * `folder:<path>` / `playlist:<id>`), which is what makes minimize/close/taskbar
 * work on them for free; this hook just owns the open-lists and the open/close
 * lifecycle, and auto-closes windows whose folder/playlist no longer exists.
 *
 * Parallel to (and independent of) the video windows — see useVideoWindows.
 */
export function useExplorerWindows(deps: ExplorerDeps) {
  const {
    setWinState,
    playlist, removeTrack, desktopFolders, selectedFolder, setSelectedFolder, setView,
    userPlaylists, createPlaylist, addTrackToPlaylist,
  } = deps;

  const [openFolders, setOpenFolders] = React.useState<string[]>([]);
  const folderWinId = (path: string) => `folder:${path}`;
  const [openPlaylists, setOpenPlaylists] = React.useState<string[]>([]);
  const playlistWinId = (id: string) => `playlist:${id}`;

  // Open a folder as its own explorer window (double-click on a desktop icon).
  // Re-opening an already-open folder focuses/restores it instead of duplicating.
  const openFolder = (folderPath: string) => {
    setOpenFolders((prev) => (prev.some((p) => samePath(p, folderPath)) ? prev : [...prev, folderPath]));
    setWinState((s) => ({ ...s, [folderWinId(folderPath)]: { open: true, minimized: false } }));
  };

  const closeFolder = (folderPath: string) => {
    setOpenFolders((prev) => prev.filter((p) => !samePath(p, folderPath)));
    setWinState((s) => {
      const { [folderWinId(folderPath)]: _closed, ...rest } = s;
      return rest;
    });
  };

  // Removes every track at or beneath the folder — a root's tracks mostly live in
  // its subfolders, so a non-recursive delete would leave the icon on the desktop.
  const deleteFolderFromLibrary = async (folderPath: string) => {
    const toDelete = playlist.filter(
      (t) => t.nativePath && (samePath(dirOf(t.nativePath), folderPath) || isUnder(t.nativePath, folderPath))
    );
    await Promise.all(toDelete.map((track) => removeTrack(track.id)));
    if (selectedFolder && (samePath(selectedFolder, folderPath) || isUnder(selectedFolder, folderPath))) {
      setSelectedFolder(null);
      setView('songs');
    }
  };

  // A folder window whose root no longer has any tracks (deleted, or its drive
  // was cleared out) has nothing left to show — close it.
  React.useEffect(() => {
    const live = new Set(desktopFolders.map((f) => f.path.toLowerCase()));
    const stale = openFolders.filter((p) => !live.has(p.toLowerCase()) && !desktopFolders.some((f) => isUnder(p, f.path)));
    if (stale.length > 0) stale.forEach(closeFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopFolders]);

  // ─── Playlists ────────────────────────────────────────────────────────────
  const openPlaylist = (id: string) => {
    setOpenPlaylists((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setWinState((s) => ({ ...s, [playlistWinId(id)]: { open: true, minimized: false } }));
  };

  const closePlaylist = (id: string) => {
    setOpenPlaylists((prev) => prev.filter((p) => p !== id));
    setWinState((s) => {
      const { [playlistWinId(id)]: _closed, ...rest } = s;
      return rest;
    });
  };

  // The "+" desktop tile: make a playlist and open its window so the user can
  // rename it and drop tracks straight in. Auto-named to avoid a blocking prompt.
  const handleNewPlaylist = async () => {
    const id = await createPlaylist(`PLAYLIST_${userPlaylists.length + 1}`);
    openPlaylist(id);
  };

  // Drop a track from a folder window onto a desktop playlist icon.
  const handleDropTrackOnPlaylist = (playlistId: string, trackId: string) => {
    addTrackToPlaylist(playlistId, trackId);
  };

  // Close any playlist window whose playlist was deleted.
  React.useEffect(() => {
    const live = new Set(userPlaylists.map((p) => p.id));
    const stale = openPlaylists.filter((id) => !live.has(id));
    if (stale.length > 0) stale.forEach(closePlaylist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPlaylists]);

  // Clear both open-lists (used by the layout reset; winState is reset separately).
  const resetExplorerWindows = () => {
    setOpenFolders([]);
    setOpenPlaylists([]);
  };

  return {
    openFolders,
    folderWinId,
    openFolder,
    closeFolder,
    deleteFolderFromLibrary,
    openPlaylists,
    playlistWinId,
    openPlaylist,
    closePlaylist,
    handleNewPlaylist,
    handleDropTrackOnPlaylist,
    resetExplorerWindows,
  };
}
