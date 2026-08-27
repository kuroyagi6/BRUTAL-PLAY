import React from 'react';
import { ListMusic } from 'lucide-react';
import type { Playlist } from '../types';
import { getTrackDropId, isTrackDrag, useCrossWindowDrag } from '../utils/trackDrag';
import { isDragging, type DragState } from '../utils/dragSession';
import { DesktopIcon, type IconPos } from './DesktopIcon';

// Playlist icons on the desktop. One tile per user playlist — creating a new one
// lives in the desktop right-click menu (NEW_PLAYLIST), not a tile, to save space.
// Freely positioned on the canvas (drag to move; positions from App, persisted).
// Each tile is a drop target: drag a track from a folder window onto it to add the
// song. Double-click opens the playlist window.
//
// Container is pointer-events:none so gaps still reach the desktop menu; tiles
// opt back in. Sits at the same z-layer as the folder icons.
//
// Drops arrive over TWO transports. A drag from a window in THIS document
// carries the track on dataTransfer. A drag from a POPPED-OUT window is a
// different OS window, and HTML5 drag events never cross windows — no
// dragover/drop payload arrives at all, so that drop used to fail silently:
// the tile never lit up and never called preventDefault, which makes the
// browser reject the drop outright. The main-process drag session is the only
// channel that crosses, so the tile also accepts a drop while a session is
// live and resolves the id from it (see trackDrag.ts / dragSession.ts).

interface DesktopPlaylistsProps {
  playlists: Playlist[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  onOpen: (id: string) => void;
  onDropTrack: (playlistId: string, trackId: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const PlaylistTile: React.FC<{
  playlist: Playlist;
  /** Live cross-window drag, if any. Subscribed once by the list, not per tile. */
  session: DragState;
  onOpen: () => void;
  onDropTrack: (trackId: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}> = ({ playlist, session, onOpen, onDropTrack, onContextMenu }) => {
  const [over, setOver] = React.useState(false);

  return (
    <button
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        // A cross-window drag has no dataTransfer payload here, so the live
        // session is what says "this is one of ours".
        if (!isTrackDrag(e) && !isDragging(session)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = getTrackDropId(e, session);
        if (!id) return;
        e.preventDefault();
        onDropTrack(id);
      }}
      title={`${playlist.name}\n${playlist.trackIds.length} tracks\n(double-click to open · drop a track to add · drag to move)`}
      className="pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group focus:outline-none"
    >
      <div
        className={`relative w-14 h-14 flex items-center justify-center border-2 transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)] ${
          over
            ? 'border-brutal-neon bg-brutal-neon text-brutal-black scale-110'
            : 'border-brutal-white bg-brutal-black/70 text-brutal-neon group-hover:bg-brutal-neon group-hover:text-brutal-black'
        }`}
      >
        <ListMusic size={26} />
        <span className="absolute -bottom-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-brutal-black border border-brutal-white text-brutal-white font-mono text-[8px]">
          {playlist.trackIds.length}
        </span>
      </div>
      <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
        {playlist.name}
      </span>
    </button>
  );
};

export const DesktopPlaylists: React.FC<DesktopPlaylistsProps> = ({
  playlists,
  positions,
  onMove,
  onOpen,
  onDropTrack,
  onContextMenu,
}) => {
  // One subscription for the whole icon layer; inert outside Electron.
  const session = useCrossWindowDrag();

  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {playlists.map((p) => {
        const id = `playlist:${p.id}`;
        return (
          <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
            <PlaylistTile
              playlist={p}
              session={session}
              onOpen={() => onOpen(p.id)}
              onDropTrack={(trackId) => onDropTrack(p.id, trackId)}
              onContextMenu={(e) => onContextMenu(e, p.id)}
            />
          </DesktopIcon>
        );
      })}
    </div>
  );
};
