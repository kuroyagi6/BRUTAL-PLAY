import React from 'react';
import { Play, Music, ListMusic, X, Check, Pencil, Unplug, Plus } from 'lucide-react';
import type { Playlist, Track } from '../types';
import type { NodeRef } from '../audio/wires';
import { formatTime } from '../utils/format';
import { getTrackDropId, isTrackDrag, setTrackDrag, useCrossWindowDrag } from '../utils/trackDrag';
import { isDragging } from '../utils/dragSession';

// The playlist interface: an editable-title header with play-all, and a track
// list that doubles as a drop target — drag songs in from a folder window (or
// another playlist) to add them. Tracks resolve from the master library in the
// playlist's own order; a missing id (track deleted from the library) is simply
// skipped, so the window never shows a dead row.

interface PlaylistWindowProps {
  playlist: Playlist;
  /** The master library, used to resolve trackIds → Track and to find play indices. */
  library: Track[];
  offlinePaths: Set<string>;
  currentTrackId: string | null;
  isPlaying: boolean;
  playTrack: (index: number, orderedIds?: string[], source?: NodeRef) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  renamePlaylist: (playlistId: string, name: string) => void;
}

export const PlaylistWindow: React.FC<PlaylistWindowProps> = ({
  playlist,
  library,
  offlinePaths,
  currentTrackId,
  isPlaying,
  playTrack,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  renamePlaylist,
}) => {
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(playlist.name);
  const [dragOver, setDragOver] = React.useState(false);

  const byId = React.useMemo(() => new Map(library.map((t) => [t.id, t])), [library]);
  // Resolve in playlist order; drop ids the library no longer has.
  const tracks = React.useMemo(
    () => playlist.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t),
    [playlist.trackIds, byId]
  );
  const orderedIds = React.useMemo(() => tracks.map((t) => t.id), [tracks]);
  const totalMs = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const isMissing = (t: Track) => !!t.nativePath && offlinePaths.has(t.nativePath.toLowerCase());

  const play = (track: Track) => {
    const index = library.findIndex((t) => t.id === track.id);
    if (index >= 0) playTrack(index, orderedIds, { kind: 'playlist', key: playlist.id });
  };

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== playlist.name) renamePlaylist(playlist.id, next);
    else setDraftName(playlist.name);
    setEditing(false);
  };

  // Accepts drops from this document (dataTransfer) AND from a popped-out
  // window, whose drag never crosses the DOM — see DesktopPlaylists for why.
  const session = useCrossWindowDrag();

  const onDrop = (e: React.DragEvent) => {
    setDragOver(false);
    const id = getTrackDropId(e, session);
    if (!id) return;
    e.preventDefault();
    addTrackToPlaylist(playlist.id, id);
  };

  return (
    <div
      className="relative h-full flex flex-col bg-brutal-black text-brutal-white"
      onDragOver={(e) => {
        if (!isTrackDrag(e) && !isDragging(session)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually left the window, not on every
        // child boundary crossing.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b-4 border-brutal-white bg-brutal-black p-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 shrink-0 flex items-center justify-center border-2 border-brutal-white bg-brutal-neon text-brutal-black">
            <ListMusic size={24} />
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName();
                    if (e.key === 'Escape') { setDraftName(playlist.name); setEditing(false); }
                  }}
                  className="flex-1 min-w-0 bg-brutal-black border-2 border-brutal-neon px-2 py-1 font-display text-xl uppercase text-brutal-white focus:outline-none"
                />
                <button onClick={commitName} className="p-1.5 border-2 border-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors" title="SAVE">
                  <Check size={14} strokeWidth={3} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setDraftName(playlist.name); setEditing(true); }}
                className="group flex items-center gap-2 max-w-full"
                title="RENAME"
              >
                <span className="font-display text-2xl uppercase leading-none truncate">{playlist.name}</span>
                <Pencil size={13} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            )}
            <p className="font-mono text-[10px] uppercase tracking-widest text-brutal-white/50 mt-1.5">
              {tracks.length} TRACKS{totalMs > 0 ? ` // ${formatTime(totalMs)}` : ''}
            </p>
          </div>

          <button
            onClick={() => tracks[0] && play(tracks[0])}
            disabled={tracks.length === 0}
            title={`PLAY_ALL_${tracks.length}`}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-2 border-brutal-white bg-brutal-neon text-brutal-black font-mono text-[11px] uppercase enabled:hover:bg-brutal-white transition-colors disabled:opacity-25"
          >
            <Play size={13} fill="currentColor" /> PLAY
          </button>
        </div>
      </div>

      {/* ─── Track list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {tracks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 border-2 border-dashed border-brutal-white/20 text-brutal-white/40">
            <Plus size={40} strokeWidth={1.5} />
            <p className="font-mono text-[11px] uppercase tracking-widest">DROP_TRACKS_HERE</p>
            <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/25">
              DRAG_A_SONG_FROM_A_FOLDER
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track, i) => {
              const active = track.id === currentTrackId;
              const offline = isMissing(track);
              return (
                <div
                  key={track.id}
                  draggable
                  onDragStart={(e) => setTrackDrag(e, track.id)}
                  onDoubleClick={() => play(track)}
                  className={`group w-full flex items-center gap-3 px-2 py-1.5 border-2 transition-colors cursor-grab active:cursor-grabbing ${
                    active
                      ? 'border-brutal-neon bg-brutal-neon/10 text-brutal-neon'
                      : 'border-transparent hover:border-brutal-white/40'
                  } ${offline ? 'opacity-40' : ''}`}
                  title={`${track.name}\n(double-click to play)`}
                >
                  <span className="shrink-0 w-6 flex justify-center font-mono text-[10px] tabular-nums">
                    {active && isPlaying ? (
                      <span className="w-2 h-2 bg-brutal-neon animate-pulse" />
                    ) : offline ? (
                      <Unplug size={12} className="text-red-500" />
                    ) : (
                      <span className="opacity-40 group-hover:opacity-0">{i + 1}</span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 font-mono text-[11px] uppercase truncate">{track.name}</span>
                  <span className="shrink-0 font-mono text-[10px] opacity-40 truncate max-w-[30%] hidden sm:block">
                    {track.artist || '—'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] opacity-50 tabular-nums">
                    {formatTime(track.duration || 0)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeTrackFromPlaylist(playlist.id, track.id); }}
                    className="shrink-0 p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                    title="REMOVE_FROM_PLAYLIST"
                  >
                    <X size={13} strokeWidth={3} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drop overlay — only while a track is being dragged over the window */}
      {dragOver && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-brutal-black/70 border-4 border-brutal-neon">
          <div className="flex flex-col items-center gap-2 text-brutal-neon">
            <Plus size={48} strokeWidth={2} />
            <p className="font-display text-xl uppercase">ADD_TO_{playlist.name}</p>
          </div>
        </div>
      )}
    </div>
  );
};
