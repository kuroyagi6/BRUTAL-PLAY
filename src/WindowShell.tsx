import React from 'react';
import { Minimize2 } from 'lucide-react';
import { PlayerProvider, usePlayer } from './player/PlayerContext';
import { usePlayerBus } from './player/usePlayerBus';
import { LanguageProvider } from './i18n/LanguageContext';
import type { Lang } from './i18n/strings';
import { usePersistentState } from './hooks/usePersistentState';
import { useMissingPaths } from './hooks/useMissingPaths';
import { QueueView } from './components/QueueView';
import { LyricsWindow } from './components/LyricsWindow';
import { FxRackView } from './components/FxRackView';
import { StageView } from './components/StageView';
import { FolderWindow } from './components/FolderWindow';
import { PlaylistWindow } from './components/PlaylistWindow';
import { VISUALIZER_MODES, type VisualizerMode } from './components/Visualizer';

// STAGE manages its own visualizer mode (persisted under the same key the desktop
// uses). Kept a tiny component so the shell's content map stays declarative.
function StageWindow() {
  const [mode, setMode] = usePersistentState<VisualizerMode>('brutal-visualizerMode', 'BARS');
  const cycle = () => setMode(VISUALIZER_MODES[(VISUALIZER_MODES.indexOf(mode) + 1) % VISUALIZER_MODES.length]);
  return <StageView visualizerMode={mode} onCycleVisualizer={cycle} />;
}

// The DYNAMIC (per-object) windows take props rather than reading context, so
// each gets a thin wrapper that pulls what it needs off the bus. Two known
// degradations when popped out (vs in-document): right-click folder menus are
// omitted (the desktop's menu host isn't in this window), and dragging a track
// OUT to a desktop drop target won't complete (native HTML5 drag doesn't cross
// OS windows — playback via click still works).

function FolderWindowClient({ root }: { root: string }) {
  const { playlist, currentTrack, isPlaying, playTrack, unlinkedFolders, toggleFolderLink } = usePlayer();
  const offlinePaths = useMissingPaths(playlist);
  return (
    <FolderWindow
      root={root}
      playlist={playlist}
      offlinePaths={offlinePaths}
      currentTrackId={currentTrack?.id ?? null}
      isPlaying={isPlaying}
      playTrack={playTrack}
      unlinkedFolders={unlinkedFolders}
      onToggleFolderLink={toggleFolderLink}
    />
  );
}

function PlaylistWindowClient({ id }: { id: string }) {
  const {
    userPlaylists, playlist, currentTrack, isPlaying, playTrack,
    addTrackToPlaylist, removeTrackFromPlaylist, renamePlaylist,
  } = usePlayer();
  const offlinePaths = useMissingPaths(playlist);
  const pl = userPlaylists.find((p) => p.id === id);
  if (!pl) {
    return <div className="p-6 font-mono text-[11px] uppercase text-brutal-white/60">PLAYLIST_NOT_FOUND</div>;
  }
  return (
    <PlaylistWindow
      playlist={pl}
      library={playlist}
      offlinePaths={offlinePaths}
      currentTrackId={currentTrack?.id ?? null}
      isPlaying={isPlaying}
      playTrack={playTrack}
      addTrackToPlaylist={addTrackToPlaylist}
      removeTrackFromPlaylist={removeTrackFromPlaylist}
      renamePlaylist={renamePlaylist}
    />
  );
}

// The renderer entry for a POPPED-OUT window. Loaded when the bundle is opened
// with ?window=<id> (see main.tsx). It renders JUST that one window's content as
// a client of the player bus — no desktop, no engine. usePlayer() inside these
// views is fed by usePlayerBus (IPC), so this window drives the real engine in
// the desktop process without running any audio itself: it can't block it.

const STATIC_CONTENT: Record<string, React.ReactNode> = {
  queue: <QueueView />,
  // No onOpenSettings here: a popped-out window has no window manager, so the
  // MEANING corner's "open settings" shortcut simply doesn't render.
  lyrics: <LyricsWindow />,
  fx: <FxRackView />,
  player: <StageWindow />,
};

// Dynamic (per-object) window ids carry their target after a prefix.
const FOLDER_PREFIX = 'folder:';
const PLAYLIST_PREFIX = 'playlist:';

/** True for any window id this shell can render standalone (static or dynamic). */
export function isPoppableWindow(id: string): boolean {
  return id in STATIC_CONTENT || id.startsWith(FOLDER_PREFIX) || id.startsWith(PLAYLIST_PREFIX);
}

/** Short human label for the popped window's header strip. */
function windowLabel(windowId: string): string {
  if (windowId.startsWith(FOLDER_PREFIX)) {
    const p = windowId.slice(FOLDER_PREFIX.length);
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return ((i >= 0 ? p.slice(i + 1) : p) || p).toUpperCase();
  }
  if (windowId.startsWith(PLAYLIST_PREFIX)) return 'PLAYLIST';
  return windowId.toUpperCase();
}

function renderContent(windowId: string): React.ReactNode {
  if (windowId.startsWith(FOLDER_PREFIX)) return <FolderWindowClient root={windowId.slice(FOLDER_PREFIX.length)} />;
  if (windowId.startsWith(PLAYLIST_PREFIX)) return <PlaylistWindowClient id={windowId.slice(PLAYLIST_PREFIX.length)} />;
  return (
    STATIC_CONTENT[windowId] ?? (
      <div className="p-6 font-mono text-[11px] uppercase text-brutal-white/60">UNKNOWN_WINDOW: {windowId}</div>
    )
  );
}

export function WindowShell({ windowId }: { windowId: string }) {
  const player = usePlayerBus();
  // Same persisted key the desktop uses; localStorage is shared across
  // same-origin BrowserWindows, so this window opens in the user's language.
  const [lang] = usePersistentState<Lang>('brutal-language', 'en');

  // DOCK BACK returns this window to the desktop. Only offered in Electron —
  // there's nothing to dock into when this page is opened in a plain browser.
  const dockApi = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
  const canDock = !!dockApi?.windowDock;

  return (
    <PlayerProvider value={player}>
      <LanguageProvider lang={lang}>
        <div className="w-screen h-screen flex flex-col overflow-hidden bg-brutal-black text-brutal-white">
          {/* Thin faceplate strip: names the module and docks it back. A strip
              rather than a floating button so it can never cover content (STAGE
              already uses its own top-right corner). */}
          {canDock && (
            <div className="shrink-0 h-7 flex items-center justify-between gap-2 px-2 bg-brutal-white text-brutal-black border-b-4 border-brutal-black select-none">
              <span className="font-display text-[11px] uppercase truncate tracking-tight">
                {windowLabel(windowId)}
              </span>
              <button
                onClick={() => dockApi.windowDock(windowId)}
                title="DOCK BACK // return this module to the desktop"
                className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 font-mono text-[9px] uppercase border-2 border-brutal-black hover:bg-brutal-neon transition-colors"
              >
                <Minimize2 size={11} strokeWidth={3} />
                DOCK
              </button>
            </div>
          )}
          <div className="flex-1 overflow-hidden">{renderContent(windowId)}</div>
        </div>
      </LanguageProvider>
    </PlayerProvider>
  );
}
