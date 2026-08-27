import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Plus, Music, Volume2, VolumeX, Trash2, Sun, Moon, Disc, User, ListMusic, ChevronLeft, Keyboard, X, Layout, Maximize2, Mic2, Image as ImageIcon, Shuffle, Repeat, Settings, LayoutGrid, List, FileText, RotateCcw, FolderOpen, ListOrdered, SlidersHorizontal, Film, Youtube, Radar, Cloud } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useMediaSession } from './hooks/useMediaSession';
import { VISUALIZER_MODES, VisualizerMode } from './components/Visualizer';
import { StageView } from './components/StageView';
import { BrutalWindow } from './components/BrutalWindow';
import { Taskbar } from './components/Taskbar';
import { WallpaperLayer } from './components/WallpaperLayer';
import { DesktopFolders } from './components/DesktopFolders';
import { DesktopPlaylists } from './components/DesktopPlaylists';
import { DesktopPins } from './components/DesktopPins';
import { DesktopStations } from './components/DesktopStations';
import { usePinnedNodes } from './hooks/usePinnedNodes';
import { pinId } from './library/pinnedNodes';
import { DesktopYouTube } from './components/DesktopYouTube';
import { DesktopCloud } from './components/DesktopCloud';
import { DriveView } from './components/DriveView';
import { DesktopWidgets, widgetIds } from './components/DesktopWidgets';
import { RadarView } from './components/RadarView';
import { useRadar, useOnlineRadar } from './hooks/useRadar';
import { ownedArtists } from './services/recommend';
import { warmThumbs } from './services/thumbCache';
import { YouTubePlayerWindow } from './components/YouTubePlayerWindow';
import { WiresLayer, type WireShape, type WireCurrent } from './components/WiresLayer';
import type { IconPos } from './components/DesktopIcon';
import { isIconLocked, toggleIconLock } from './hooks/useIconLock';
import { folderLabel, useFolderAliases } from './library/folderAliases';
import { RenameFolderDialog } from './components/RenameFolderDialog';
import { FolderWindow } from './components/FolderWindow';
import { PlaylistWindow } from './components/PlaylistWindow';
import { DesktopVideos, videoIconFor } from './components/DesktopVideos';
import { VideoFolderWindow } from './components/VideoFolderWindow';
import { VideoPlayerWindow } from './components/VideoPlayerWindow';
import { folderIconFor } from './components/FolderIcon';
import { rootFolders } from './library/folderTree';
import { useVideoLibrary } from './library/useVideoLibrary';
import { useFolderWatch } from './library/useFolderWatch';
import { useRemoteServer, type RemoteStatus, type RemoteDevice } from './remote/useRemoteServer';
import { MenuHost } from './menus/MenuHost';
import { useContextMenu } from './menus/useContextMenu';
import type { MenuActions } from './menus/types';

// Extracted Components & Utils
import { SettingsView } from './components/SettingsView';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { LyricsWindow } from './components/LyricsWindow';
import { QueueView } from './components/QueueView';
import { FxRackView } from './components/FxRackView';
import { LibraryView, View, LibraryViewMode, LibrarySortMode } from './components/LibraryView';
import type { RatingFilter } from './library/explicit';
import { SpotlightSearch } from './components/SpotlightSearch';
import { useDynamicTheme } from './hooks/useDynamicTheme';
import { usePersistentState } from './hooks/usePersistentState';
import { useWallpaper } from './hooks/useWallpaper';
import { useMissingPaths } from './hooks/useMissingPaths';
import { useWindowManager } from './hooks/useWindowManager';
import { useExplorerWindows } from './hooks/useExplorerWindows';
import { useVideoWindows, VIDEO_PLAYER_ID } from './hooks/useVideoWindows';
import { PlayerProvider } from './player/PlayerContext';
import { isPoppableWindow } from './WindowShell';
import { usePublishPlayer } from './player/publishPlayer';
import { usePublishVisualizer } from './player/publishVisualizer';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useStations } from './hooks/useStations';
import { useCloudSources } from './hooks/useCloudSources';
import { useGoogleDrive } from './hooks/useGoogleDrive';
import { useYouTube, YOUTUBE_PLAYER_ID } from './hooks/useYouTube';
import { applyFontPreset, DEFAULT_FONT_PRESET } from './theme/fontPresets';
import { BackgroundsView } from './components/BackgroundsView';
import { LanguageProvider } from './i18n/LanguageContext';
import { Lang, translate } from './i18n/strings';
import * as dbService from './services/dbService';
import { DEFAULT_SHORTCUTS, normalizeConfig, type ShortcutConfig } from './shortcuts/registry';

// A window is defined once as data; the framework handles open/close/minimize
// and the taskbar. Adding a new panel = one entry here + a case in
// renderWindowContent(). Runtime open/minimized state lives in `winState`.
interface WindowDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  pos: { x: number; y: number };
  size: { width: number; height: number };
  /** Whether the window is open on first load / after a layout reset. Default true. */
  defaultOpen?: boolean;
  /** Open maximized (fills the desktop). Default true; set false to open floating at pos/size. */
  openMaximized?: boolean;
}

// `title` is an i18n key (see src/i18n/strings.ts), resolved at render so window
// titles follow the language toggle.
const WINDOW_DEFS: WindowDef[] = [
  { id: 'library', title: 'win.library', icon: <ListMusic />, pos: { x: 50, y: 100 }, size: { width: 380, height: 600 } },
  { id: 'player', title: 'win.player', icon: <Disc />, pos: { x: 450, y: 100 }, size: { width: 600, height: 650 } },
  { id: 'lyrics', title: 'win.lyrics', icon: <Mic2 />, pos: { x: 1070, y: 100 }, size: { width: 380, height: 650 } },
  { id: 'queue', title: 'win.queue', icon: <ListOrdered />, pos: { x: 450, y: 300 }, size: { width: 360, height: 460 }, defaultOpen: false },
  { id: 'fx', title: 'win.fx', icon: <SlidersHorizontal />, pos: { x: 820, y: 180 }, size: { width: 360, height: 560 }, defaultOpen: false },
  { id: 'settings', title: 'win.settings', icon: <Settings />, pos: { x: 300, y: 80 }, size: { width: 640, height: 680 }, defaultOpen: false, openMaximized: false },
  { id: 'backgrounds', title: 'win.backgrounds', icon: <ImageIcon />, pos: { x: 260, y: 140 }, size: { width: 780, height: 460 }, defaultOpen: false, openMaximized: false },
  { id: 'radar', title: 'win.radar', icon: <Radar />, pos: { x: 340, y: 120 }, size: { width: 560, height: 620 }, defaultOpen: false, openMaximized: false },
  // EXPERIMENTAL Google Drive (cloud sources Phase 2). Always in the registry so
  // the taskbar/reset code needs no special case; only reachable when the cloud
  // layer is toggled on.
  { id: 'drive', title: 'win.drive', icon: <Cloud />, pos: { x: 320, y: 110 }, size: { width: 560, height: 640 }, defaultOpen: false, openMaximized: false },
];

// Ids of the fixed panels, stable across renders — the window runtime state and
// reset both key off these. Dynamic windows (folders/playlists/videos) are added
// to winState on demand. Runtime open/minimized state lives in useWindowManager.
const PANEL_IDS = WINDOW_DEFS.map((d) => d.id);

export default function App() {
  const [theme, setTheme] = usePersistentState<'dark' | 'light'>('brutal-theme', 'dark');
  const [view, setView] = React.useState<View>('songs');
  const [selectedAlbum, setSelectedAlbum] = React.useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = React.useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = React.useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = React.useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [visualizerMode, setVisualizerMode] = usePersistentState<VisualizerMode>('brutal-visualizerMode', 'BARS');
  const [dynamicTheme, setDynamicTheme] = usePersistentState<boolean>('brutal-dynamicTheme', true);
  const [accentColor, setAccentColor] = usePersistentState<string | null>('brutal-accentColor', null);
  const [fontPreset, setFontPreset] = usePersistentState<string>('brutal-fontPreset', DEFAULT_FONT_PRESET);
  // Fresh key (was 'brutal-lang') so the new English default takes effect even
  // though the old default was already persisted during this session.
  const [lang, setLang] = usePersistentState<Lang>('brutal-language', 'en');
  const [viewMode, setViewMode] = usePersistentState<'desktop' | 'tablet' | 'mobile'>('brutal-viewMode', 'desktop');
  const [zoom, setZoom] = usePersistentState<number>('brutal-zoom', 0.9);
  // Wire looks: cable routing + what runs through it. Both default to the
  // original look, so an existing desktop is unchanged until it's opted out.
  const [wireShape, setWireShape] = usePersistentState<WireShape>('brutal-wireShape', 'curved');
  const [wireCurrent, setWireCurrent] = usePersistentState<WireCurrent>('brutal-wireCurrent', 'bolt');
  // Desktop wallpaper: active wallpaper + overlay, the imported-image gallery,
  // and import/select/delete handlers. Self-contained (see hooks/useWallpaper).
  const {
    wallpaper, setWallpaper,
    wpOverlay, setWpOverlay,
    wpImageUrl, wpImageIds,
    wallpaperInputRef,
    handleWallpaperFile,
    selectWallpaperImage,
    removeWallpaperImage,
  } = useWallpaper();
  // Local translator for App-level chrome (App hosts the provider, so it can't
  // use the useI18n hook itself).
  const t = React.useCallback((key: string) => translate(lang, key), [lang]);

  // Device-frame width for the desktop workspace. null = full width.
  const frameWidth = viewMode === 'tablet' ? 1024 : viewMode === 'mobile' ? 560 : null;
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  // Persisted, user-configurable keybindings. Stored partial; merged over the
  // defaults so a newly added action always resolves (see shortcuts/registry).
  const [storedShortcuts, setStoredShortcuts] = usePersistentState<ShortcutConfig>('brutal-shortcuts', DEFAULT_SHORTCUTS);
  const shortcuts = React.useMemo(() => normalizeConfig(storedShortcuts), [storedShortcuts]);
  // Auto-import: watch imported folders and pull in songs added to them later.
  const [watchFolders, setWatchFolders] = usePersistentState<boolean>('brutal-watchFolders', true);
  // LAN remote: opt-in, off by default (it opens a network port). Status is live,
  // not persisted — it's whatever the server reports after start/stop.
  const [remoteEnabled, setRemoteEnabled] = usePersistentState<boolean>('brutal-remoteEnabled', false);
  // Experimental internet-radio layer: opt-in, off by default. A parallel audio
  // stack (own <audio> element) — see hooks/useStations.ts. Only coupling below.
  const [stationsEnabled, setStationsEnabled] = usePersistentState<boolean>('brutal-stationsEnabled', false);
  // Add-station dialog open state, lifted here so the desktop right-click menu
  // (NEW_STATION) can open it — the desktop tile that used to do it is gone.
  const [stationAddOpen, setStationAddOpen] = React.useState(false);
  // Experimental YouTube layer: opt-in, off by default. Embedded-player stack —
  // see hooks/useYouTube.ts. Add dialog opened from the desktop menu (NEW_YOUTUBE).
  const [youtubeEnabled, setYoutubeEnabled] = usePersistentState<boolean>('brutal-youtubeEnabled', false);
  const [youtubeAddOpen, setYoutubeAddOpen] = React.useState(false);
  // Experimental cloud sources: opt-in, off by default. Shows the Google Drive /
  // iCloud folders already synced to this PC as desktop icons that feed the
  // ordinary folder importer — see hooks/useCloudSources.ts. No cloud API and no
  // login anywhere; while the flag is off the hook does nothing at all.
  const [cloudEnabled, setCloudEnabled] = usePersistentState<boolean>('brutal-cloudEnabled', false);
  // RADAR: suggestions for tracks by your artists that the library lacks. Opt-in
  // and off by default — a scan sends artist names to Deezer. The flag lives in
  // its own hook (localStorage + cross-window sync), like the other online opt-ins.
  const [radarEnabled, setRadarEnabled] = useOnlineRadar();
  const [remoteStatus, setRemoteStatus] = React.useState<RemoteStatus | null>(null);
  const [remoteDevices, setRemoteDevices] = React.useState<RemoteDevice[]>([]);
  const [libraryViewMode, setLibraryViewMode] = usePersistentState<LibraryViewMode>('brutal-libraryViewMode', 'DEFAULT');
  const [librarySortMode, setLibrarySortMode] = usePersistentState<LibrarySortMode>('brutal-librarySortMode', 'DEFAULT');
  const [ratingFilter, setRatingFilter] = usePersistentState<RatingFilter>('brutal-ratingFilter', 'ALL');
  // Free-canvas desktop: where each icon sits, keyed by "kind:key". Unplaced
  // icons fall back to a default grid (see iconPositionsResolved). Persisted.
  const [iconPositions, setIconPositions] = usePersistentState<Record<string, IconPos>>('brutal-icon-positions', {});
  const moveIcon = React.useCallback(
    (id: string, pos: IconPos) => setIconPositions((prev) => ({ ...prev, [id]: pos })),
    [setIconPositions]
  );
  const [showViewMenu, setShowViewMenu] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(0);

  // The window system runtime: open/minimized state, focus, close-confirm, the
  // per-window imperative handles, and the live-copy refs the global keydown
  // handler reads. Dynamic windows share `winState` via the returned setter.
  // See hooks/useWindowManager.
  const {
    winState, setWinState, resetWindows,
    toggleMinimize, closeWindow, openWindow, handleTaskbarClick,
    focusedWindowId, setFocusedWindowId, focusedWindowIdRef,
    closeConfirm, setCloseConfirm, closeConfirmRef, confirmOpenRef,
    winRefs, winStateRef, menuOpenRef, overlayOpenRef,
  } = useWindowManager(PANEL_IDS, showShortcuts);
  const [isSpotlightOpen, setIsSpotlightOpen] = React.useState(false);


  const handleResetLayout = () => {
    setResetToken(prev => prev + 1);
    resetWindows();
    resetExplorerWindows();
    resetVideoWindows();
    youtube.resetYouTube();
  };

  // Keep the document class in sync with the persisted theme (also applies it on startup)
  React.useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Apply the chosen typeface preset (overrides --font-display / --font-sans).
  React.useEffect(() => {
    applyFontPreset(fontPreset);
  }, [fontPreset]);

  // Apply the page zoom (overrides the base html { zoom } from index.css).
  React.useEffect(() => {
    (document.documentElement.style as any).zoom = String(zoom);
  }, [zoom]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // The whole playback API. Kept as one object so it can be provided via
  // PlayerContext (player-only windows read it with usePlayer instead of props),
  // then destructured for App's own logic and the still-drilled views.
  const player = useAudioPlayer();
  // ENGINE SIDE of the cross-window player bus: publish this window's live player
  // state and apply commands from other windows. No-ops outside Electron (no
  // electronAPI) and invisible until windows actually consume the bus (Phase 1),
  // so mounting it here changes nothing observable today. See publishPlayer.ts.
  usePublishPlayer(player);
  // ENGINE SIDE of the visualizer stream. Streams analyser frames ONLY when a
  // client window subscribes (demand) AND audio plays — neither happens in the
  // single window today, so the loop never runs. See publishVisualizer.ts.
  usePublishVisualizer(player.analyser, player.isPlaying);
  const {
    playlist,
    currentTrack,
    isPlaying,
    progress,
    duration,
    togglePlay,
    playTrack,
    playNext,
    playPrev,
    seek,
    addFiles,
    addNativeFiles,
    removeTrack,
    removeDuplicates,
    isMuted,
    toggleMute,
    volume,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    userPlaylists,
    createPlaylist,
    renamePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    wires,
    addWire,
    removeWire,
    removeNodeWires,
    setVideoWireHandler,
    setYouTubeWireHandler,
    playWireNode,
    unlinkedFolders,
    toggleFolderLink,
  } = player;

  // Warm the persistent cover-thumbnail cache (services/thumbCache.ts) shortly
  // after the library loads, so the media-library window opens with thumbs
  // already built instead of generating them on first click. The delay keeps
  // the first paint of the desktop ahead of background decode work; existing
  // thumbs just get their session URL minted, which is cheap.
  React.useEffect(() => {
    if (playlist.length === 0) return;
    const timer = window.setTimeout(() => warmThumbs(playlist), 1500);
    return () => window.clearTimeout(timer);
  }, [playlist]);

  // Route OS media-session actions (headphone taps: 1=play/pause, 2=next,
  // 3=prev — Bluetooth AVRCP / wired remotes) into the transport. Contained in
  // its own hook; see src/hooks/useMediaSession.ts.
  useMediaSession({
    currentTrack,
    isPlaying,
    progress,
    duration,
    togglePlay,
    playNext,
    playPrev,
    seek,
  });

  // The video library — a fully separate layer. It never touches the audio engine
  // above; App composes both and is the only place they meet (music pauses when a
  // video starts, wired at the player's onPlay below).
  const {
    videos,
    addNativeVideos,
    removeVideosUnder,
    noteVideoMeta,
  } = useVideoLibrary();

  // Experimental internet-radio: a separate audio stack with its own <audio>
  // element. Mounted regardless (cheap, no network until a station is played),
  // but its icons only render when the feature is toggled on. See useStations.
  const stations = useStations();

  // Experimental cloud sources. Gated on the flag so a disabled layer performs no
  // detection at all. Nothing here touches the audio engine — importing from a
  // cloud tile runs the same folder-import code as picking a folder by hand.
  const cloud = useCloudSources(cloudEnabled);

  // Phase 2 of the same layer: the Drive API, for files that were never synced
  // to disk. Gated on the same flag. Importing downloads to a real folder and
  // then runs the ordinary importer, so the engine never learns Drive exists.
  const drive = useGoogleDrive(cloudEnabled);

  // The one coupling to the music engine, both directions — mirrors the video
  // layer's "video pauses music" rule:
  //   • starting a station pauses music (done in playStationById below), and
  //   • starting music stops the station, so the two never overlap.
  const playStationById = React.useCallback(
    (id: string) => {
      if (isPlaying) togglePlay(); // pause library playback before the stream starts
      stations.playStation(id);
    },
    [isPlaying, togglePlay, stations]
  );
  React.useEffect(() => {
    if (isPlaying) stations.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Lowercased native paths whose file is currently unreachable (drive removed).
  // Re-checked on library change and window focus. See hooks/useMissingPaths.
  const missingPaths = useMissingPaths(playlist);

  // Distinct source folders of the library, derived from track paths. A folder is
  // `offline` only when every track in it is currently unreachable.
  const importedFolders = React.useMemo(() => {
    const parentDir = (p: string) => {
      const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
      return i > 0 ? p.slice(0, i) : p;
    };
    const acc = new Map<string, { count: number; offline: number }>();
    for (const track of playlist) {
      if (!track.nativePath) continue;
      const dir = parentDir(track.nativePath);
      const e = acc.get(dir) ?? { count: 0, offline: 0 };
      e.count += 1;
      if (missingPaths.has(track.nativePath.toLowerCase())) e.offline += 1;
      acc.set(dir, e);
    }
    return [...acc.entries()]
      .map(([path, e]) => ({ path, count: e.count, offline: e.count > 0 && e.offline === e.count }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [playlist, missingPaths]);

  // The desktop shows one icon per *import root* (see `rootFolders`), not one per
  // leaf directory: subfolders belong inside that folder's own window, which is
  // where the hierarchy and drill-down live.
  const desktopFolders = React.useMemo(
    () => rootFolders(playlist, (p) => missingPaths.has(p.toLowerCase())),
    [playlist, missingPaths]
  );


  // Dynamic explorer windows — one per opened music folder and one per opened
  // playlist. They share the window manager's `winState` (keyed folder:/playlist:)
  // so minimize/close/taskbar work for free. See hooks/useExplorerWindows.
  const {
    openFolders, folderWinId, openFolder, closeFolder, deleteFolderFromLibrary,
    openPlaylists, playlistWinId, openPlaylist, closePlaylist,
    handleNewPlaylist, handleDropTrackOnPlaylist, resetExplorerWindows,
  } = useExplorerWindows({
    setWinState,
    playlist, removeTrack, desktopFolders, selectedFolder, setSelectedFolder, setView,
    userPlaylists, createPlaylist, addTrackToPlaylist,
  });

  // ─── Videos ─────────────────────────────────────────────────────────────────
  // The video layer's windows (explorer + single player) and the wire/chain
  // playback linking them to the audio side. Parallel to the audio queue; shares
  // the window manager's `winState`. See hooks/useVideoWindows.
  const {
    desktopVideos, openVideoFolders, videoFolderWinId,
    currentVideo, videoPlaying, setVideoPlaying,
    openVideoFolder, closeVideoFolder, openVideo, onVideoEnded, closeVideoPlayer,
    deleteVideoFolderFromLibrary, pauseMusicForVideo, resetVideoWindows,
  } = useVideoWindows({
    setWinState, videos, removeVideosUnder, missingPaths,
    wires, playWireNode, setVideoWireHandler, isPlaying, togglePlay,
  });

  // Experimental YouTube layer: a saved list of videos/playlists driving one
  // embedded-player window. Parallel to the video layer; shares winState. The only
  // audio-engine coupling (opening pauses music) lives inside the hook. See
  // hooks/useYouTube.ts.
  const youtube = useYouTube({
    setWinState, isPlaying, togglePlay,
    wires, setYouTubeWireHandler, playWireNode, removeNodeWires,
  });

  // Starter examples: the first time the YouTube layer is switched on (and the
  // list is empty), drop in a couple of stable, well-known streams so the desktop
  // isn't blank. Fires only on the off→on transition, so an intentionally-emptied
  // list stays empty across reloads.
  const prevYoutubeEnabled = React.useRef(youtubeEnabled);
  React.useEffect(() => {
    const was = prevYoutubeEnabled.current;
    prevYoutubeEnabled.current = youtubeEnabled;
    if (youtubeEnabled && !was && youtube.items.length === 0) {
      youtube.addYouTube('LOFI_RADIO', 'https://www.youtube.com/watch?v=jfKfPfyJRdk');
      youtube.addYouTube('SYNTHWAVE_RADIO', 'https://www.youtube.com/watch?v=4xDzrJKXOOY');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeEnabled]);

  // ─── Pinned albums/artists ──────────────────────────────────────────────────
  // Albums and artists are derived from tags, not objects the user made, so they
  // only reach the desktop by being pinned from their page. Once there they are
  // ordinary wire nodes — the player resolves them in `playSource` like a folder.
  const pinned = usePinnedNodes(playlist);
  // Reads the library to diff against Deezer. Never scans on its own — the scan
  // is a button in the RADAR window (see hooks/useRadar).
  const radar = useRadar(playlist, radarEnabled);
  // Distinct artists in the library — RADAR reports how many a scan would cover.
  const artistCount = React.useMemo(() => ownedArtists(playlist).size, [playlist]);

  const openPinPage = React.useCallback(
    (pinKind: 'album' | 'artist', key: string) => {
      if (pinKind === 'artist') {
        setSelectedArtist(key);
        setView('artist-detail');
      } else {
        setSelectedAlbum(key);
        setView('album-detail');
      }
      openWindow('library');
    },
    [openWindow]
  );

  const unpinNode = React.useCallback(
    (pinKind: 'album' | 'artist', key: string) => {
      pinned.unpin(pinKind, key);
      // Drop any wire touching it, or the chain keeps a dangling endpoint.
      removeNodeWires({ kind: pinKind, key });
    },
    [pinned, removeNodeWires]
  );

  // App is the ONLY owner of the pin list. usePersistentState is plain useState
  // + a write effect, so a second usePinnedNodes() elsewhere would be a divergent
  // copy fighting over the same localStorage key — hence these are threaded down
  // to the library's PIN buttons as props rather than re-read there.
  const togglePinNode = React.useCallback(
    (pinKind: 'album' | 'artist', key: string) => {
      if (pinned.isPinned(pinKind, key)) unpinNode(pinKind, key);
      else pinned.pin(pinKind, key);
    },
    [pinned, unpinNode]
  );

  // Resolve every desktop icon's position: a stored spot wins, otherwise a
  // deterministic default grid slot by stable order (folders, playlists, the
  // new-playlist tile, videos). Icons are freely draggable; this is just where
  // they start before anyone moves them.
  const iconPositionsResolved = React.useMemo(() => {
    const ids = [
      ...desktopFolders.map((f) => `folder:${f.path}`),
      ...userPlaylists.map((p) => `playlist:${p.id}`),
      ...desktopVideos.map((f) => `video:${f.path}`),
      // Stations, YouTube and pins appended last so enabling/adding them never
      // shifts existing icons' slots.
      ...(stationsEnabled ? stations.stations.map((s) => `station:${s.id}`) : []),
      ...(youtubeEnabled ? youtube.items.map((i) => `youtube:${i.id}`) : []),
      // Cloud tiles carry their own 'cloud:<path>' ids (see cloudSourceId).
      ...(cloudEnabled ? cloud.sources.map((s) => s.id) : []),
      ...pinned.pins.map((p) => pinId(p)),
      // Widgets share the icon position store, so they are dragged, clamped and
      // persisted by exactly the same code as the icons.
      ...widgetIds(radarEnabled),
    ];
    const ROWS = 5, CELL_X = 104, CELL_Y = 112, ORIGIN = 16;
    const out: Record<string, IconPos> = {};
    ids.forEach((id, i) => {
      out[id] = iconPositions[id] ?? {
        x: ORIGIN + Math.floor(i / ROWS) * CELL_X,
        y: ORIGIN + (i % ROWS) * CELL_Y,
      };
    });
    return out;
  }, [desktopFolders, userPlaylists, desktopVideos, iconPositions, stationsEnabled, stations.stations, youtubeEnabled, youtube.items, cloudEnabled, cloud.sources, pinned.pins, radarEnabled]);

  // Wire endpoints currently on the desktop: folders, playlists, video roots, and
  // pinned albums/artists. Offline roots can't play, so they aren't wirable.
  // Feeds WiresLayer.
  const wireNodeIds = React.useMemo(
    () => [
      ...desktopFolders.filter((f) => !f.offline).map((f) => `folder:${f.path}`),
      ...userPlaylists.map((p) => `playlist:${p.id}`),
      ...desktopVideos.filter((f) => !f.offline).map((f) => `video:${f.path}`),
      // YouTube nodes are wirable only while the experimental layer is on.
      ...(youtubeEnabled ? youtube.items.map((i) => `youtube:${i.id}`) : []),
      // `pinned.pins` is already filtered to pins that still resolve to tracks,
      // so an album whose files vanished can't become a dead end in a chain.
      ...pinned.pins.map((p) => pinId(p)),
    ],
    [desktopFolders, userPlaylists, desktopVideos, youtubeEnabled, youtube.items, pinned.pins]
  );


  // Human label for the confirm dialog, by window kind.
  const windowLabel = (id: string): string => {
    if (id.startsWith('video:')) return folderLabel(id.slice('video:'.length));
    if (id === VIDEO_PLAYER_ID) return currentVideo?.name ?? 'VIDEO_PLAYER';
    if (id === YOUTUBE_PLAYER_ID) return youtube.currentItem?.name ?? 'YOUTUBE';
    if (id.startsWith('folder:')) return folderLabel(id.slice('folder:'.length));
    if (id.startsWith('playlist:')) return userPlaylists.find((p) => playlistWinId(p.id) === id)?.name ?? 'PLAYLIST';
    const def = WINDOW_DEFS.find((d) => d.id === id);
    return def ? t(def.title) : id;
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Brutalist CSS custom properties: sampled from cover art when dynamic, else a
  // manual accent / CSS defaults. See hooks/useDynamicTheme.
  useDynamicTheme(currentTrack?.coverUrl, theme, dynamicTheme, accentColor);

  const toggleVisualizer = () => {
    const nextIndex = (VISUALIZER_MODES.indexOf(visualizerMode) + 1) % VISUALIZER_MODES.length;
    setVisualizerMode(VISUALIZER_MODES[nextIndex]);
  };

  // The global keydown handler (spotlight, confirm dialog, transport + window
  // keybinds). Returns performClose, also used by the confirm dialog below.
  // See hooks/useGlobalShortcuts.
  const { performClose } = useGlobalShortcuts({
    shortcuts, focusedWindowId,
    focusedWindowIdRef, winStateRef, winRefs, confirmOpenRef, closeConfirmRef, menuOpenRef, overlayOpenRef,
    toggleMinimize, closeWindow, setCloseConfirm, setFocusedWindowId,
    closeFolder, closePlaylist, closeVideoFolder, closeVideoPlayer,
    togglePlay, playNext, playPrev, toggleMute, toggleShuffle, toggleRepeat,
    setIsSpotlightOpen, setShowShortcuts, toggleTheme, toggleVisualizer,
  });

  const handleClearLibrary = async () => {
    try {
      await dbService.clearAllData();
    } catch (e) {
      console.error('Failed to clear library:', e);
    }
    window.location.reload();
  };

  const handleResetSettings = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('brutal-'))
      .forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  // Every context menu in the app — desktop, folder icons, taskbar Start button —
  // shares this one controller. See src/menus/registry.tsx to add a new target.
  const menu = useContextMenu();
  menuOpenRef.current = !!menu.state;
  // Which folder icon the rename dialog is open for (null = closed). The
  // aliases themselves live in their own store; App only owns "who's editing".
  const [renameFolderPath, setRenameFolderPath] = React.useState<string | null>(null);
  // Repaints App's own folder labels (window titles, taskbar chips) on rename.
  // The icons subscribe themselves; this covers the chrome around them.
  useFolderAliases();
  const menuActions: MenuActions = {
    importFolder: () => handleImport('folder'),
    importFiles: () => handleImport('files'),
    importVideoFolder: () => handleImportVideo(),
    newPlaylist: handleNewPlaylist,
    newStation: () => setStationAddOpen(true),
    newYouTube: () => setYoutubeAddOpen(true),
    resetLayout: handleResetLayout,
    changeWallpaper: () => openWindow('backgrounds'),
    openSettings: () => openWindow('settings'),
    openFolder,
    deleteFolder: deleteFolderFromLibrary,
    openVideoFolder,
    deleteVideoFolder: deleteVideoFolderFromLibrary,
    openPlaylist,
    deletePlaylist,
    openPin: openPinPage,
    unpin: unpinNode,
    // Icon lock lives in its own module store (DesktopIcon subscribes per icon),
    // so the menu talks to it directly rather than through App state.
    iconLocked: isIconLocked,
    toggleIconLock,
    renameFolder: setRenameFolderPath,
  };

  const [importStatus, setImportStatus] = React.useState<string | null>(null);
  const importStatusTimer = React.useRef<number | null>(null);

  const flashImportStatus = (message: string, autoHideMs?: number) => {
    if (importStatusTimer.current) {
      clearTimeout(importStatusTimer.current);
      importStatusTimer.current = null;
    }
    setImportStatus(message);
    if (autoHideMs) {
      importStatusTimer.current = window.setTimeout(() => setImportStatus(null), autoHideMs);
    }
  };

  // Import a known list of on-disk paths. Split out of handleImport so callers
  // that already HAVE paths can reuse the identical scan/persist/report path —
  // the Google Drive window downloads files and then imports them through here,
  // which is why a Drive track ends up indistinguishable from a local one.
  const importPaths = async (paths: string[]) => {
    if (!paths || paths.length === 0) return;
    flashImportStatus(`IMPORTING_${paths.length}_FILES...`);
    const { added, skipped, persistFailed } = await addNativeFiles(paths, ({ phase, done, total }) =>
      flashImportStatus(
        `${phase === 'saving' ? 'SAVING' : 'READING_TAGS'} // ${done}/${total}`
      )
    );
    if (added === 0 && skipped > 0) {
      flashImportStatus('NO_NEW_TRACKS // ALL_ALREADY_IN_LIBRARY', 4000);
    } else if (added === 0) {
      flashImportStatus('NO_AUDIO_FILES_FOUND', 4000);
    } else if (persistFailed > 0) {
      // Tracks play now, but the library DB is broken — warn so the user knows
      // they won't survive a restart until the DB is reset.
      flashImportStatus(`ADDED_${added} // ${persistFailed}_NOT_SAVED (DB_ERROR // SEE_SETTINGS)`, 8000);
    } else {
      flashImportStatus(`ADDED_${added}_TRACK${added === 1 ? '' : 'S'}${skipped > 0 ? ` // SKIPPED_${skipped}_DUPES` : ''}`, 4000);
    }
  };

  // `defaultPath` (folder mode only) opens the picker inside a given folder — the
  // cloud tiles pass their mount root. Omitted everywhere else, so the plain
  // IMPORT flow is unchanged.
  const handleImport = async (mode: 'folder' | 'files' = 'folder', defaultPath?: string) => {
    const api = (window as any).electronAPI;
    const picker = mode === 'files' ? api?.selectMusicFiles : api?.selectMusicFolder;
    if (!picker) {
      // Browser fallback: native file input
      fileInputRef.current?.click();
      return;
    }
    try {
      const paths: string[] = await picker(mode === 'folder' ? defaultPath : undefined);
      if (!paths || paths.length === 0) return; // dialog canceled
      await importPaths(paths);
    } catch (e) {
      console.error('Import failed:', e);
      flashImportStatus('IMPORT_FAILED // CHECK_CONSOLE', 5000);
    }
  };

  // Import a folder of videos. Uses its own picker + scanner (video extensions)
  // and its own library, so nothing here touches the audio import path.
  const handleImportVideo = async () => {
    const api = (window as any).electronAPI;
    if (!api?.selectVideoFolder) {
      flashImportStatus('VIDEO_IMPORT_NEEDS_THE_DESKTOP_APP', 4000);
      return;
    }
    try {
      const paths: string[] = await api.selectVideoFolder();
      if (!paths || paths.length === 0) return; // canceled
      flashImportStatus(`IMPORTING_${paths.length}_VIDEOS...`);
      const { added, skipped } = await addNativeVideos(paths);
      if (added === 0 && skipped > 0) {
        flashImportStatus('NO_NEW_VIDEOS // ALL_ALREADY_IN_LIBRARY', 4000);
      } else if (added === 0) {
        flashImportStatus('NO_VIDEO_FILES_FOUND', 4000);
      } else {
        flashImportStatus(`ADDED_${added}_VIDEO${added === 1 ? '' : 'S'}${skipped > 0 ? ` // SKIPPED_${skipped}_DUPES` : ''}`, 4000);
      }
    } catch (e) {
      console.error('Video import failed:', e);
      flashImportStatus('VIDEO_IMPORT_FAILED // CHECK_CONSOLE', 5000);
    }
  };

  // Auto-import: watch the library's root folders and fold in songs dropped into
  // them later. Composed here (App owns both `playlist` and `addNativeFiles`) so
  // the library and audio engine stay untouched; it drives the same importer the
  // button does, whose de-dupe keeps re-scans from adding anything twice.
  useFolderWatch({
    enabled: watchFolders,
    playlist,
    addNativeFiles,
    onAutoImported: (added) =>
      flashImportStatus(`AUTO_ADDED_${added}_NEW_TRACK${added === 1 ? '' : 'S'}`, 4000),
  });

  // LAN remote server: control the PC from a phone AND stream a track to play on
  // the phone. Composed here (App owns both the transport and the library) so the
  // audio engine stays untouched — the hook only reads state and calls the public
  // transport. See src/remote/useRemoteServer.ts.
  // Phone picks a library track for the PC to play. Built from the existing
  // index-based playTrack so the engine stays untouched; the whole library
  // becomes the queue so next/prev work after a phone-initiated play.
  const playTrackId = React.useCallback(
    (id: string) => {
      const i = playlist.findIndex((t) => t.id === id);
      if (i >= 0) playTrack(i, playlist.map((t) => t.id));
    },
    [playlist, playTrack]
  );

  useRemoteServer({
    enabled: remoteEnabled,
    player: {
      playlist,
      currentTrack,
      isPlaying,
      progress,
      duration,
      volume,
      isMuted,
      togglePlay,
      playNext,
      playPrev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      toggleRepeat,
      isShuffle: player.shuffle,
      repeatMode: player.repeatMode,
      playTrackId,
    },
    videos,
    onStatus: setRemoteStatus,
    onDevices: setRemoteDevices,
  });

  // Device management from the PC. Optimistically refresh the list after each
  // action so the UI reacts before the next 3s poll.
  const refreshDevices = React.useCallback(() => {
    (window as any).electronAPI?.remoteDevices?.().then(setRemoteDevices).catch(() => {});
  }, []);
  const trustDevice = React.useCallback(
    (id: string, trusted: boolean) => {
      (window as any).electronAPI?.remoteTrust?.(id, trusted).then(refreshDevices).catch(() => {});
    },
    [refreshDevices]
  );
  const kickDevice = React.useCallback(
    (id: string) => {
      (window as any).electronAPI?.remoteKick?.(id).then(refreshDevices).catch(() => {});
    },
    [refreshDevices]
  );

  // Pop a window OUT of the desktop into its own OS process (Electron only).
  // Opens the standalone window, then closes the in-document copy so there's no
  // duplicate. The titlebar button only appears when this is available.
  const canPopOut = typeof window !== 'undefined' && !!(window as any).electronAPI?.windowOpen;
  const popOutWindow = React.useCallback((id: string) => {
    (window as any).electronAPI?.windowOpen?.(id);
    closeWindow(id);
  }, [closeWindow]);
  const popOutProps = (id: string) =>
    canPopOut && isPoppableWindow(id) ? { onPopOut: () => popOutWindow(id) } : {};

  // Which windows are currently popped out into their own OS window. The desktop
  // skips rendering an in-document copy of these so there's never a duplicate.
  const [poppedWindows, setPoppedWindows] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onWindowList) return;
    api.windowRequestList?.().then((ids: string[]) => setPoppedWindows(new Set(ids))).catch(() => {});
    return api.onWindowList((ids: string[]) => setPoppedWindows(new Set(ids)));
  }, []);

  // A popped-out window asked to dock back: re-open it in-document. Main closes
  // the standalone window, and the resulting window:list clears it from
  // poppedWindows, so the in-document copy takes over.
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onWindowDock) return;
    return api.onWindowDock((id: string) => openWindow(id));
  }, [openWindow]);

  // Taskbar click: a popped-out window lives in its own OS window, so focus THAT
  // instead of re-opening an in-document copy. Everything else behaves as before.
  const onTaskbarSelect = React.useCallback((id: string) => {
    if (poppedWindows.has(id)) {
      (window as any).electronAPI?.windowOpen?.(id);
      return;
    }
    handleTaskbarClick(id);
  }, [poppedWindows, handleTaskbarClick]);

  // Content for each window id. Keeping this a switch (rather than data) lets each
  // panel close over all the player state it needs while the framework stays
  // generic. Adding a window = a new WINDOW_DEFS entry + a case here.
  const renderWindowContent = (id: string): React.ReactNode => {
    switch (id) {
      case 'library':
        return (
          <LibraryView
            view={view}
            setView={setView}
            libraryViewMode={libraryViewMode}
            setLibraryViewMode={setLibraryViewMode}
            showViewMenu={showViewMenu}
            setShowViewMenu={setShowViewMenu}
            selectedAlbum={selectedAlbum}
            setSelectedAlbum={setSelectedAlbum}
            selectedArtist={selectedArtist}
            setSelectedArtist={setSelectedArtist}
            selectedGenre={selectedGenre}
            setSelectedGenre={setSelectedGenre}
            selectedPlaylist={selectedPlaylist}
            setSelectedPlaylist={setSelectedPlaylist}
            selectedFolder={selectedFolder}
            setSelectedFolder={setSelectedFolder}
            offlinePaths={missingPaths}
            librarySortMode={librarySortMode}
            setLibrarySortMode={setLibrarySortMode}
            ratingFilter={ratingFilter}
            setRatingFilter={setRatingFilter}
            onImport={handleImport}
            isPinned={pinned.isPinned}
            onTogglePin={togglePinNode}
          />
        );
      case 'player':
        return (
          <StageView
            visualizerMode={visualizerMode}
            onCycleVisualizer={toggleVisualizer}
          />
        );
      case 'lyrics':
        return <LyricsWindow onOpenSettings={() => openWindow('settings')} />;
      case 'queue':
        return <QueueView />;
      case 'fx':
        return <FxRackView />;
      case 'radar':
        return (
          <RadarView
            radar={radar}
            enabled={radarEnabled}
            onEnable={() => setRadarEnabled(true)}
            artistCount={artistCount}
          />
        );
      case 'settings':
        return (
          <SettingsView
            setShowShortcuts={setShowShortcuts}
            theme={theme}
            toggleTheme={toggleTheme}
            visualizerMode={visualizerMode}
            setVisualizerMode={setVisualizerMode}
            watchFolders={watchFolders}
            setWatchFolders={setWatchFolders}
            stationsEnabled={stationsEnabled}
            setStationsEnabled={setStationsEnabled}
            youtubeEnabled={youtubeEnabled}
            setYoutubeEnabled={setYoutubeEnabled}
            cloudEnabled={cloudEnabled}
            setCloudEnabled={setCloudEnabled}
            cloudSourceCount={cloud.sources.length}
            cloudScanning={cloud.scanning}
            cloudScanned={cloud.scanned}
            remoteEnabled={remoteEnabled}
            setRemoteEnabled={setRemoteEnabled}
            remoteStatus={remoteStatus}
            remoteDevices={remoteDevices}
            onTrustDevice={trustDevice}
            onKickDevice={kickDevice}
            dynamicTheme={dynamicTheme}
            setDynamicTheme={setDynamicTheme}
            accentColor={accentColor}
            setAccentColor={setAccentColor}
            fontPreset={fontPreset}
            setFontPreset={setFontPreset}
            lang={lang}
            setLang={setLang}
            viewMode={viewMode}
            setViewMode={setViewMode}
            zoom={zoom}
            setZoom={setZoom}
            wireShape={wireShape}
            setWireShape={setWireShape}
            wireCurrent={wireCurrent}
            setWireCurrent={setWireCurrent}
            onOpenBackgrounds={() => openWindow('backgrounds')}
            folders={importedFolders}
            onAddFolder={() => handleImport('folder')}
            trackCount={playlist.length}
            onResetLayout={handleResetLayout}
            onClearLibrary={handleClearLibrary}
            onResetSettings={handleResetSettings}
            onRemoveDuplicates={removeDuplicates}
          />
        );
      case 'drive':
        return <DriveView drive={drive} onImportPaths={importPaths} />;
      case 'backgrounds':
        return (
          <BackgroundsView
            wallpaper={wallpaper}
            setWallpaper={setWallpaper}
            overlay={wpOverlay}
            setOverlay={setWpOverlay}
            activeImageUrl={wpImageUrl}
            artUrl={currentTrack?.coverUrl ?? null}
            imageIds={wpImageIds}
            onImport={() => wallpaperInputRef.current?.click()}
            onSelectImage={selectWallpaperImage}
            onDeleteImage={removeWallpaperImage}
          />
        );
      default:
        return null;
    }
  };

  return (
    <PlayerProvider value={player}>
    <LanguageProvider lang={lang}>
    {/* Pinned to the viewport (h-screen) so the wallpaper never scrolls. The
        mobile/tablet layout was removed pending a rebuild — this is desktop-only. */}
    <div className="h-screen bg-brutal-black p-4 md:p-6 flex flex-col items-center selection:bg-brutal-neon selection:text-brutal-black overflow-hidden relative">
      <div className="w-full max-w-[1600px] flex flex-col gap-6 h-full min-h-0">

        {/* Header removed — its actions (IMPORT / RESET / SETTINGS) now live in
            the taskbar Start menu and the desktop right-click menu (SystemMenu),
            freeing the full space for the desktop / drop-zone. */}
        <input type="file" ref={fileInputRef} className="hidden" multiple accept="audio/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <input type="file" ref={wallpaperInputRef} className="hidden" accept="image/*" onChange={(e) => { handleWallpaperFile(e.target.files?.[0]); e.target.value = ''; }} />

        <div
            // `min-h-0` (not a fixed 800px floor) lets the desktop shrink to the
            // space the flex column actually has, so the wallpaper always fits the
            // viewport instead of pushing the page into a scroll.
            className={`flex-1 relative min-h-0 ${
              frameWidth
                ? 'w-full self-center border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] overflow-hidden'
                : 'w-full'
            }`}
            style={frameWidth ? { maxWidth: frameWidth } : undefined}
            // Right-click on empty desktop (not on a window) opens the system menu.
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return;
              menu.openAt(e, { kind: 'desktop', stationsEnabled, youtubeEnabled });
            }}
          >
            {/* Desktop wallpaper behind the windows (preset / color / custom image) */}
            <WallpaperLayer wallpaper={wallpaper} imageUrl={wpImageUrl} artUrl={currentTrack?.coverUrl ?? null} overlay={wpOverlay} />

            {/* Floats over the wallpaper like the taskbar, costing it no height */}
            <SpotlightSearch
              playlist={playlist}
              userPlaylists={userPlaylists}
              importedFolders={importedFolders}
              playTrack={playTrack}
              setSelectedAlbum={setSelectedAlbum}
              setSelectedArtist={setSelectedArtist}
              setSelectedGenre={setSelectedGenre}
              setSelectedFolder={setSelectedFolder}
              setSelectedPlaylist={setSelectedPlaylist}
              setView={setView}
              openWindow={openWindow}
              isOpen={isSpotlightOpen}
              setIsOpen={setIsSpotlightOpen}
              floating
            />

            {/* Import roots as desktop icons (double-click opens an explorer window) */}
            <DesktopFolders
              folders={desktopFolders}
              positions={iconPositionsResolved}
              onMove={moveIcon}
              onOpen={openFolder}
              onContextMenu={(e, path) => menu.openAt(e, { kind: 'folder', path })}
            />

            {/* Albums + artists pinned from their library page. Ordinary wire
                nodes; double-click opens the page they were pinned from. */}
            <DesktopPins
              pins={pinned.pins}
              tracks={playlist}
              positions={iconPositionsResolved}
              onMove={moveIcon}
              onOpen={(p) => openPinPage(p.kind, p.key)}
              onContextMenu={(e, p) => menu.openAt(e, { kind: 'pin', pinKind: p.kind, key: p.key })}
            />

            {/* Playlists as desktop icons: drop a track to add, "+" to create */}
            <DesktopPlaylists
              playlists={userPlaylists}
              positions={iconPositionsResolved}
              onMove={moveIcon}
              onOpen={openPlaylist}
              onDropTrack={handleDropTrackOnPlaylist}
              onContextMenu={(e, id) => {
                const p = userPlaylists.find((pl) => pl.id === id);
                menu.openAt(e, { kind: 'playlist', id, name: p?.name ?? '' });
              }}
            />

            {/* EXPERIMENTAL internet-radio stations as desktop icons. Only mounts
                when toggled on in Settings. Its own audio stack; double-click
                plays, "+" adds. */}
            {stationsEnabled && (
              <DesktopStations
                stations={stations.stations}
                positions={iconPositionsResolved}
                onMove={moveIcon}
                onOpen={playStationById}
                onAdd={stations.addStation}
                onRemove={stations.removeStation}
                onRename={stations.renameStation}
                addOpen={stationAddOpen}
                onCloseAdd={() => setStationAddOpen(false)}
                currentStationId={stations.currentStationId}
                playing={stations.playing}
                connecting={stations.connecting}
              />
            )}

            {/* EXPERIMENTAL YouTube videos/playlists as desktop icons. Only mounts
                when toggled on in Settings. Double-click opens the embedded player;
                add via the desktop right-click menu (NEW_YOUTUBE). */}
            {youtubeEnabled && (
              <DesktopYouTube
                items={youtube.items}
                positions={iconPositionsResolved}
                onMove={moveIcon}
                onOpen={youtube.playYouTube}
                onAdd={youtube.addYouTube}
                onRemove={youtube.removeYouTube}
                onRename={youtube.renameYouTube}
                addOpen={youtubeAddOpen}
                onCloseAdd={() => setYoutubeAddOpen(false)}
                currentItemId={youtube.currentItem?.id ?? null}
              />
            )}

            {/* EXPERIMENTAL cloud sources (Google Drive / iCloud sync folders) as
                desktop icons. Only mounts when toggled on in Settings. A tile is a
                doorway, not a container: double-click opens the folder picker
                already inside that cloud, and whatever you pick imports as normal
                library tracks. Deliberately not a bulk import — Drive streams
                files on demand, so scanning a whole root would force-download it. */}
            {cloudEnabled && (
              <DesktopCloud
                sources={cloud.sources}
                positions={iconPositionsResolved}
                onMove={moveIcon}
                onImport={(s) => handleImport('folder', s.path)}
                onHide={cloud.hideSource}
                // Phase 2: reach files that were never synced to this PC. Only
                // Google Drive has an API for that — iCloud has none at all.
                onOpenDrive={
                  cloud.sources.some((s) => s.provider === 'google-drive')
                    ? () => handleTaskbarClick('drive')
                    : undefined
                }
              />
            )}

            {/* Imported video roots as desktop icons */}
            <DesktopVideos
              folders={desktopVideos}
              positions={iconPositionsResolved}
              onMove={moveIcon}
              onOpen={openVideoFolder}
              onContextMenu={(e, path) => menu.openAt(e, { kind: 'video-folder', path })}
            />

            {/* Live cards on the canvas (RADAR suggestions). Movable like an icon
                — they share the icon position store and drag wrapper. Only
                mounts when the RADAR opt-in is on. */}
            <DesktopWidgets
              radarEnabled={radarEnabled}
              radar={radar}
              positions={iconPositionsResolved}
              onMove={moveIcon}
              onOpenRadar={() => openWindow('radar')}
            />

            {/* Cables linking desktop objects for end-to-end playback. Above the
                icons, below the windows; drag a node's handle to wire, click to cut.
                Numbers on the icons show play order (1 = start). */}
            <WiresLayer
              wires={wires}
              nodeIds={wireNodeIds}
              positions={iconPositionsResolved}
              onCreate={addWire}
              onRemove={removeWire}
              shape={wireShape}
              current={wireCurrent}
            />

            {/* WINDOWS SYSTEM — rendered from the registry. A window that's been
                popped into its own OS window is skipped here so it isn't drawn twice. */}
            {WINDOW_DEFS.map((def, i) =>
              winState[def.id].open && !poppedWindows.has(def.id) ? (
                <BrutalWindow
                  key={def.id}
                  id={def.id}
                  ref={(h) => { winRefs.current[def.id] = h; }}
                  title={t(def.title)}
                  icon={def.icon}
                  isMinimized={winState[def.id].minimized}
                  onMinimize={() => toggleMinimize(def.id)}
                  onClose={() => closeWindow(def.id)}
                  {...popOutProps(def.id)}
                  onFocus={() => setFocusedWindowId(def.id)}
                  defaultMaximized={def.openMaximized !== false}
                  zIndex={i + 1}
                  initialPos={def.pos}
                  initialSize={def.size}
                  resetToken={resetToken}
                >
                  {renderWindowContent(def.id)}
                </BrutalWindow>
              ) : null
            )}

            {/* EXPLORER WINDOWS — one per opened folder, cascaded so they don't stack */}
            {openFolders.map((path, i) => {
              const id = folderWinId(path);
              const runtime = winState[id];
              if (!runtime?.open || poppedWindows.has(id)) return null;
              const Icon = folderIconFor(path);
              return (
                <BrutalWindow
                  key={id}
                  id={id}
                  ref={(h) => { winRefs.current[id] = h; }}
                  title={folderLabel(path)}
                  icon={<Icon />}
                  isMinimized={runtime.minimized}
                  onMinimize={() => toggleMinimize(id)}
                  onClose={() => closeFolder(path)}
                  {...popOutProps(id)}
                  onFocus={() => setFocusedWindowId(id)}
                  defaultMaximized={false}
                  zIndex={WINDOW_DEFS.length + i + 1}
                  initialPos={{ x: 140 + i * 32, y: 90 + i * 32 }}
                  initialSize={{ width: 620, height: 500 }}
                  resetToken={resetToken}
                >
                  <FolderWindow
                    root={path}
                    playlist={playlist}
                    offlinePaths={missingPaths}
                    currentTrackId={currentTrack?.id ?? null}
                    isPlaying={isPlaying}
                    playTrack={playTrack}
                    onFolderContextMenu={(e, folderPath) => menu.openAt(e, { kind: 'folder', path: folderPath })}
                    unlinkedFolders={unlinkedFolders}
                    onToggleFolderLink={toggleFolderLink}
                  />
                </BrutalWindow>
              );
            })}

            {/* PLAYLIST WINDOWS — one per opened playlist */}
            {openPlaylists.map((id, i) => {
              const pl = userPlaylists.find((p) => p.id === id);
              const winId = playlistWinId(id);
              const runtime = winState[winId];
              if (!pl || !runtime?.open || poppedWindows.has(winId)) return null;
              return (
                <BrutalWindow
                  key={winId}
                  id={winId}
                  ref={(h) => { winRefs.current[winId] = h; }}
                  title={pl.name}
                  icon={<ListMusic />}
                  isMinimized={runtime.minimized}
                  onMinimize={() => toggleMinimize(winId)}
                  onClose={() => closePlaylist(id)}
                  {...popOutProps(winId)}
                  onFocus={() => setFocusedWindowId(winId)}
                  defaultMaximized={false}
                  zIndex={WINDOW_DEFS.length + openFolders.length + i + 1}
                  initialPos={{ x: 260 + i * 32, y: 120 + i * 32 }}
                  initialSize={{ width: 560, height: 520 }}
                  resetToken={resetToken}
                >
                  <PlaylistWindow
                    playlist={pl}
                    library={playlist}
                    offlinePaths={missingPaths}
                    currentTrackId={currentTrack?.id ?? null}
                    isPlaying={isPlaying}
                    playTrack={playTrack}
                    addTrackToPlaylist={addTrackToPlaylist}
                    removeTrackFromPlaylist={removeTrackFromPlaylist}
                    renamePlaylist={renamePlaylist}
                  />
                </BrutalWindow>
              );
            })}

            {/* VIDEO EXPLORER WINDOWS — one per opened video root */}
            {openVideoFolders.map((path, i) => {
              const id = videoFolderWinId(path);
              const runtime = winState[id];
              if (!runtime?.open) return null;
              const Icon = videoIconFor(path);
              return (
                <BrutalWindow
                  key={id}
                  id={id}
                  ref={(h) => { winRefs.current[id] = h; }}
                  title={folderLabel(path)}
                  icon={<Icon />}
                  isMinimized={runtime.minimized}
                  onMinimize={() => toggleMinimize(id)}
                  onClose={() => closeVideoFolder(path)}
                  onFocus={() => setFocusedWindowId(id)}
                  defaultMaximized={false}
                  zIndex={WINDOW_DEFS.length + openFolders.length + openPlaylists.length + i + 1}
                  initialPos={{ x: 180 + i * 32, y: 110 + i * 32 }}
                  initialSize={{ width: 620, height: 500 }}
                  resetToken={resetToken}
                >
                  <VideoFolderWindow
                    root={path}
                    videos={videos}
                    offlinePaths={missingPaths}
                    currentVideoId={currentVideo?.id ?? null}
                    isPlaying={videoPlaying}
                    onOpenVideo={openVideo}
                    onFolderContextMenu={(e, folderPath) => menu.openAt(e, { kind: 'video-folder', path: folderPath })}
                  />
                </BrutalWindow>
              );
            })}

            {/* VIDEO PLAYER — a single window showing the selected clip */}
            {winState[VIDEO_PLAYER_ID]?.open && (
              <BrutalWindow
                key={VIDEO_PLAYER_ID}
                id={VIDEO_PLAYER_ID}
                ref={(h) => { winRefs.current[VIDEO_PLAYER_ID] = h; }}
                title={currentVideo?.name ?? 'VIDEO_PLAYER'}
                icon={<Film />}
                isMinimized={winState[VIDEO_PLAYER_ID].minimized}
                onMinimize={() => toggleMinimize(VIDEO_PLAYER_ID)}
                onClose={closeVideoPlayer}
                onFocus={() => setFocusedWindowId(VIDEO_PLAYER_ID)}
                defaultMaximized={false}
                zIndex={WINDOW_DEFS.length + openFolders.length + openPlaylists.length + openVideoFolders.length + 1}
                initialPos={{ x: 320, y: 90 }}
                initialSize={{ width: 720, height: 560 }}
                resetToken={resetToken}
              >
                <VideoPlayerWindow
                  video={currentVideo}
                  onPlay={pauseMusicForVideo}
                  onMeta={noteVideoMeta}
                  onPlayingChange={setVideoPlaying}
                  onEnded={onVideoEnded}
                />
              </BrutalWindow>
            )}

            {/* YOUTUBE PLAYER — a single window with the embedded YouTube player */}
            {winState[YOUTUBE_PLAYER_ID]?.open && (
              <BrutalWindow
                key={YOUTUBE_PLAYER_ID}
                id={YOUTUBE_PLAYER_ID}
                ref={(h) => { winRefs.current[YOUTUBE_PLAYER_ID] = h; }}
                title={youtube.currentItem?.name ?? 'YOUTUBE'}
                icon={<Youtube />}
                isMinimized={winState[YOUTUBE_PLAYER_ID].minimized}
                onMinimize={() => toggleMinimize(YOUTUBE_PLAYER_ID)}
                onClose={youtube.closePlayer}
                onFocus={() => setFocusedWindowId(YOUTUBE_PLAYER_ID)}
                defaultMaximized={false}
                zIndex={WINDOW_DEFS.length + openFolders.length + openPlaylists.length + openVideoFolders.length + 2}
                initialPos={{ x: 360, y: 70 }}
                initialSize={{ width: 720, height: 540 }}
                resetToken={resetToken}
              >
                <YouTubePlayerWindow
                  item={youtube.currentItem}
                  onPlay={youtube.pauseMusicForYouTube}
                  onEnded={youtube.onYouTubeEnded}
                />
              </BrutalWindow>
            )}

            <Taskbar
              windows={[
                // The Active Deck ('player') has no chip here: the now-playing
                // cover art IS its launcher (click it to open/restore), so a
                // separate taskbar chip would be a duplicate.
                ...WINDOW_DEFS.filter((d) => d.id !== 'player').map((d) => ({
                  id: d.id,
                  title: t(d.title),
                  icon: d.icon,
                  // A popped-out window is still "running", just in its own OS
                  // window — keep its chip lit so it reads as open.
                  open: winState[d.id].open || poppedWindows.has(d.id),
                  minimized: winState[d.id].minimized,
                })),
                ...openFolders.map((path) => {
                  const Icon = folderIconFor(path);
                  const wid = folderWinId(path);
                  return {
                    id: wid,
                    title: folderLabel(path),
                    icon: <Icon />,
                    open: (winState[wid]?.open ?? false) || poppedWindows.has(wid),
                    minimized: winState[wid]?.minimized ?? false,
                  };
                }),
                ...openPlaylists.map((id) => {
                  const wid = playlistWinId(id);
                  return {
                    id: wid,
                    title: userPlaylists.find((p) => p.id === id)?.name ?? 'PLAYLIST',
                    icon: <ListMusic />,
                    open: (winState[wid]?.open ?? false) || poppedWindows.has(wid),
                    minimized: winState[wid]?.minimized ?? false,
                  };
                }),
                ...openVideoFolders.map((path) => {
                  const Icon = videoIconFor(path);
                  return {
                    id: videoFolderWinId(path),
                    title: folderLabel(path),
                    icon: <Icon />,
                    open: winState[videoFolderWinId(path)]?.open ?? false,
                    minimized: winState[videoFolderWinId(path)]?.minimized ?? false,
                  };
                }),
                ...(winState[VIDEO_PLAYER_ID]?.open
                  ? [{
                      id: VIDEO_PLAYER_ID,
                      title: currentVideo?.name ?? 'VIDEO_PLAYER',
                      icon: <Film />,
                      open: true,
                      minimized: winState[VIDEO_PLAYER_ID].minimized,
                    }]
                  : []),
                ...(winState[YOUTUBE_PLAYER_ID]?.open
                  ? [{
                      id: YOUTUBE_PLAYER_ID,
                      title: youtube.currentItem?.name ?? 'YOUTUBE',
                      icon: <Youtube />,
                      open: true,
                      minimized: winState[YOUTUBE_PLAYER_ID].minimized,
                    }]
                  : []),
              ]}
              onSelect={onTaskbarSelect}
              onStart={(x, y) => menu.openAtPoint(x, y, { kind: 'desktop', stationsEnabled, youtubeEnabled })}
              nowPlaying={{
                track: currentTrack,
                isPlaying,
                progress,
                duration,
                togglePlay,
                playNext,
                playPrev,
                seek,
                onToggleDeck: () => onTaskbarSelect('player'),
                deckActive: (winState.player.open && !winState.player.minimized) || poppedWindows.has('player'),
              }}
            />
        </div>

      </div>

      <ShortcutsOverlay
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        shortcuts={shortcuts}
        setShortcuts={setStoredShortcuts}
      />

      {/* Close-confirm guard for the keyboard close bind (Enter/Esc handled in the
          global keydown handler). z above the shortcut manual (10000). */}
      <AnimatePresence>
        {closeConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-brutal-black/90 backdrop-blur-sm"
            onClick={() => setCloseConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="brutal-card w-full max-w-md p-6 bg-brutal-black border-4 border-brutal-white shadow-[12px_12px_0px_0px_var(--brutal-shadow-color)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-display uppercase leading-none">{t('confirm.closeTitle')}</h2>
              <p className="font-mono text-xs text-brutal-white/60 uppercase mt-3 break-words">
                {windowLabel(closeConfirm)}
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setCloseConfirm(null)}
                  className="flex-1 brutal-btn text-sm"
                >
                  {t('confirm.cancel')}
                </button>
                <button
                  onClick={() => performClose(closeConfirm)}
                  autoFocus
                  className="flex-1 brutal-btn text-sm bg-red-500 text-white border-brutal-black"
                >
                  {t('confirm.close')}
                </button>
              </div>
              <p className="font-mono text-[9px] text-brutal-white/30 uppercase mt-4 text-center">{t('confirm.hint')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Every context menu renders here, driven by src/menus/registry.tsx */}
      <MenuHost menu={menu} actions={menuActions} />

      {/* Folder icon rename — display name only, never the folder on disk. */}
      <RenameFolderDialog path={renameFolderPath} onClose={() => setRenameFolderPath(null)} />

      {/* EXPERIMENTAL radio: LIVE now-playing banner. A live stream has no
          progress/seek, so this is just a label + STOP (bottom-left, clear of the
          import toast at bottom-right). */}
      <AnimatePresence>
        {stationsEnabled && stations.currentStation && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="fixed bottom-6 left-6 z-[100] bg-brutal-black border-4 border-brutal-neon px-4 py-3 flex items-center gap-3 shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)]"
          >
            <span className={`w-2.5 h-2.5 rounded-full bg-brutal-neon ${stations.playing ? 'animate-pulse' : ''}`} />
            <div className="font-mono text-xs uppercase tracking-widest leading-tight max-w-[280px]">
              <div className="text-brutal-neon truncate">
                <span className="text-brutal-white/50">
                  {stations.error ? 'STREAM_ERROR // ' : stations.playing ? 'LIVE // ' : 'CONNECTING // '}
                </span>
                {stations.currentStation.name}
              </div>
              {/* ICY now-playing title (Electron only), when the stream sends one. */}
              {stations.nowPlayingTitle && (
                <div className="text-brutal-white/70 normal-case tracking-normal truncate mt-0.5">
                  ♪ {stations.nowPlayingTitle}
                </div>
              )}
            </div>
            <button
              onClick={stations.stop}
              className="ml-1 px-2 py-1 border-2 border-brutal-neon text-brutal-neon hover:bg-brutal-neon hover:text-brutal-black font-mono text-[10px] uppercase"
            >
              STOP
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import status toast */}
      <AnimatePresence>
        {importStatus && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="fixed bottom-6 right-6 z-[100] bg-brutal-black border-4 border-brutal-neon px-5 py-3 font-mono text-xs uppercase tracking-widest text-brutal-neon shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)]"
          >
            {importStatus}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LanguageProvider>
    </PlayerProvider>
  );
}
