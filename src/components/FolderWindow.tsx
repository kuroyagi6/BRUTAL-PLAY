import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Play, Music, Unplug, FolderOpen, ListFilter, Zap, Link2, Link2Off } from 'lucide-react';
import type { Track } from '../types';
import type { NodeRef } from '../audio/wires';
import { breadcrumb, continuationAfter, parentOf, readDir, samePath, tracksUnderOrdered } from '../library/folderTree';
import { folderLabel, useFolderAliases } from '../library/folderAliases';
import { sortTracks, SORT_MODES, type LibrarySortMode } from '../library/trackSort';
import { FolderIcon } from './FolderIcon';
import { formatTime } from '../utils/format';
import { setTrackDrag } from '../utils/trackDrag';
import { useI18n } from '../i18n/LanguageContext';

// An explorer window over one import root: subfolders as icons, tracks as rows,
// and drill-down navigation (back / forward / up / breadcrumb) *inside* the
// window. All the path math lives in ../library/folderTree.ts; this file only
// paints a directory listing and owns the navigation history.

interface FolderWindowProps {
  /** The folder this window was opened at. Navigation never goes above it. */
  root: string;
  /** The whole library — the listing for the current directory is derived from it. */
  playlist: Track[];
  /** Lowercased native paths that are currently unreachable. */
  offlinePaths: Set<string>;
  currentTrackId: string | null;
  isPlaying: boolean;
  /** Same contract as the Media Library: (index into playlist, the queue to adopt, the wire source). */
  playTrack: (index: number, orderedIds?: string[], source?: NodeRef) => void;
  /** Right-click on a subfolder — opens the shared folder menu. */
  onFolderContextMenu?: (e: React.MouseEvent, path: string) => void;
  /** LOWERCASED paths whose link switch is OFF (default = linked). */
  unlinkedFolders: string[];
  /** Flip a subfolder's link switch. */
  onToggleFolderLink: (path: string) => void;
}

const Toolbar: React.FC<{ label: string; icon: React.ReactNode; disabled?: boolean; onClick: () => void }> = ({
  label,
  icon,
  disabled,
  onClick,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className="p-1.5 border-2 border-brutal-white/40 text-brutal-white enabled:hover:bg-brutal-neon enabled:hover:text-brutal-black enabled:hover:border-brutal-black transition-colors disabled:opacity-25"
  >
    {icon}
  </button>
);

export const FolderWindow: React.FC<FolderWindowProps> = ({
  root,
  playlist,
  offlinePaths,
  currentTrackId,
  isPlaying,
  playTrack,
  onFolderContextMenu,
  unlinkedFolders,
  onToggleFolderLink,
}) => {
  const { t } = useI18n();

  // Navigation history, browser-style: `past` is where Back goes, `future` is
  // what Forward replays until a new drill-down truncates it.
  const [cwd, setCwd] = React.useState(root);
  const [past, setPast] = React.useState<string[]>([]);
  const [future, setFuture] = React.useState<string[]>([]);

  // Track ordering for the current listing. Local to this window (each explorer
  // sorts independently); DEFAULT keeps readDir's name-sorted order. The shared
  // sortTracks is the same one the Media Library uses.
  const [sortMode, setSortMode] = React.useState<LibrarySortMode>('DEFAULT');
  const [showSort, setShowSort] = React.useState(false);

  // The window is pinned to its root; if that root disappears from the library
  // (folder deleted) the parent unmounts this window, so no guard is needed here.
  const navigate = (path: string) => {
    if (samePath(path, cwd)) return;
    setPast((p) => [...p, cwd]);
    setFuture([]);
    setCwd(path);
  };

  const back = () => {
    setPast((p) => {
      if (p.length === 0) return p;
      setFuture((f) => [cwd, ...f]);
      setCwd(p[p.length - 1]);
      return p.slice(0, -1);
    });
  };

  const forward = () => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setPast((p) => [...p, cwd]);
      setCwd(f[0]);
      return f.slice(1);
    });
  };

  const isMissing = React.useCallback(
    (nativePath: string) => offlinePaths.has(nativePath.toLowerCase()),
    [offlinePaths]
  );

  const { folders, files } = React.useMemo(
    () => readDir(playlist, cwd, isMissing),
    [playlist, cwd, isMissing]
  );
  // What the list actually renders, and the queue a played track adopts, so
  // next/prev follow the visible order.
  const sortedFiles = React.useMemo(() => sortTracks(files, sortMode), [files, sortMode]);
  // `breadcrumb()` stays pure and path-based; only the ROOT crumb is relabelled,
  // so it matches the folder's desktop icon and window title after a rename.
  // Subfolders keep their real on-disk names — only roots can be renamed.
  const aliases = useFolderAliases();
  const crumbs = React.useMemo(() => {
    const c = breadcrumb(cwd, root);
    c[0] = { ...c[0], name: folderLabel(root) };
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, root, aliases]);
  const up = parentOf(cwd, root);

  // Per-subfolder link switch (default ON). Paths are stored lowercased.
  const unlinked = React.useMemo(() => new Set(unlinkedFolders), [unlinkedFolders]);
  const isLinked = React.useCallback((p: string) => !unlinked.has(p.toLowerCase()), [unlinked]);

  // The queue playback adopts from here: this listing top-to-bottom (linked
  // subfolders' tracks first — the icon grid sits above the rows — then this
  // folder's own files in the active sort), and, while this branch is LINKED,
  // onward through the rest of the window: at each level up to the root, the
  // other linked subfolders then that level's own files. An UNLINKED branch's
  // queue ends at its last song, so the root's wire (if any) takes over
  // directly — and with no wire, playback simply stops there.
  const queueTracks = React.useMemo(() => {
    const out: Track[] = [];
    for (const f of folders) if (isLinked(f.path)) out.push(...tracksUnderOrdered<Track>(playlist, f.path, isLinked));
    out.push(...sortedFiles);
    out.push(...continuationAfter<Track>(playlist, cwd, root, isLinked));
    return out;
  }, [folders, sortedFiles, playlist, cwd, root, isLinked]);

  const play = (track: Track) => {
    const index = playlist.findIndex((t) => t.id === track.id);
    // The wire source is this window's desktop root, not the drilled-into
    // subfolder — wires connect desktop objects.
    if (index >= 0) playTrack(index, queueTracks.map((t) => t.id), { kind: 'folder', key: root });
  };

  return (
    <div className="h-full flex flex-col bg-brutal-black text-brutal-white">
      {/* ─── Toolbar: history, up, breadcrumb, play-all ─────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 p-2 border-b-4 border-brutal-white bg-brutal-black">
        <div className="flex items-center gap-1 shrink-0">
          <Toolbar label="BACK" icon={<ArrowLeft size={14} strokeWidth={3} />} disabled={past.length === 0} onClick={back} />
          <Toolbar label="FORWARD" icon={<ArrowRight size={14} strokeWidth={3} />} disabled={future.length === 0} onClick={forward} />
          <Toolbar label="UP" icon={<ArrowUp size={14} strokeWidth={3} />} disabled={!up} onClick={() => up && navigate(up)} />
        </div>

        {/* Breadcrumb — every segment from the window root down to here is clickable */}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto custom-scrollbar border-2 border-brutal-white/40 px-2 py-1">
          {crumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              {i > 0 && <span className="font-mono text-[10px] text-brutal-white/30 shrink-0">/</span>}
              <button
                onClick={() => navigate(crumb.path)}
                disabled={i === crumbs.length - 1}
                className="font-mono text-[10px] uppercase whitespace-nowrap enabled:hover:text-brutal-neon disabled:text-brutal-neon transition-colors"
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Sort — orders the track rows below; folders stay name-sorted. */}
        <div className="relative shrink-0">
          <Toolbar
            label={t('tip.sort')}
            icon={<ListFilter size={14} strokeWidth={3} />}
            disabled={files.length === 0}
            onClick={() => setShowSort((s) => !s)}
          />
          {showSort && (
            <>
              {/* Click-away backdrop. */}
              <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
              <div className="absolute top-full right-0 mt-2 z-50 bg-brutal-black border-4 border-brutal-white shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] min-w-[130px]">
                {SORT_MODES.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setSortMode(mode);
                      setShowSort(false);
                    }}
                    className={`w-full text-left px-3 py-2 font-mono text-[10px] uppercase transition-colors flex items-center justify-between ${
                      sortMode === mode ? 'bg-brutal-neon text-brutal-black' : 'hover:bg-brutal-white/10'
                    }`}
                  >
                    {t(`mode.${mode}`)}
                    {sortMode === mode && <Zap size={10} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => queueTracks[0] && play(queueTracks[0])}
          disabled={queueTracks.length === 0}
          title={`PLAY_ALL_${queueTracks.length}`}
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-2 border-brutal-white bg-brutal-neon text-brutal-black font-mono text-[10px] uppercase enabled:hover:bg-brutal-white transition-colors disabled:opacity-25"
        >
          <Play size={12} fill="currentColor" /> {queueTracks.length}
        </button>
      </div>

      {/* ─── Listing ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {folders.length === 0 && files.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 opacity-30">
            <FolderOpen size={40} />
            <p className="font-mono text-[10px] uppercase tracking-widest">EMPTY_FOLDER</p>
          </div>
        )}

        {folders.length > 0 && (
          <>
            <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/40 mb-2">
              {folders.length}_FOLDERS
            </p>
            <div className="flex flex-wrap gap-1 mb-4">
              {folders.map((f) => {
                const linked = isLinked(f.path);
                return (
                  <div key={f.path} className="relative">
                    <FolderIcon
                      path={f.path}
                      caption={f.offline ? 'OFFLINE' : `${f.trackCount}${f.folderCount > 0 ? ` // ${f.folderCount}D` : ''}`}
                      offline={f.offline}
                      title={`${f.path}\n(double-click to open)`}
                      onOpen={() => navigate(f.path)}
                      onContextMenu={onFolderContextMenu && ((e) => onFolderContextMenu(e, f.path))}
                    />
                    {/* Link switch: does this subfolder join the parent's playback flow? */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFolderLink(f.path);
                      }}
                      title={
                        linked
                          ? 'LINKED — plays as part of this folder (click to unlink)'
                          : 'UNLINKED — skipped by the folder; plays alone when started inside (click to link)'
                      }
                      className={`absolute top-0 right-1 p-0.5 border-2 bg-brutal-black transition-colors ${
                        linked
                          ? 'border-brutal-neon text-brutal-neon hover:bg-brutal-neon hover:text-brutal-black'
                          : 'border-brutal-white/30 text-brutal-white/30 hover:border-brutal-white hover:text-brutal-white'
                      }`}
                    >
                      {linked ? <Link2 size={10} strokeWidth={3} /> : <Link2Off size={10} strokeWidth={3} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {files.length > 0 && (
          <>
            <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/40 mb-2 pt-1 border-t-2 border-brutal-white/10">
              {files.length}_TRACKS
            </p>
            <div className="space-y-1">
              {sortedFiles.map((track) => {
                const active = track.id === currentTrackId;
                const offline = !!track.nativePath && isMissing(track.nativePath);
                return (
                  <button
                    key={track.id}
                    draggable
                    onDragStart={(e) => setTrackDrag(e, track.id)}
                    onDoubleClick={() => play(track)}
                    className={`w-full flex items-center gap-3 px-2 py-1.5 border-2 text-left transition-colors cursor-grab active:cursor-grabbing ${
                      active
                        ? 'border-brutal-neon bg-brutal-neon/10 text-brutal-neon'
                        : 'border-transparent hover:border-brutal-white/40'
                    } ${offline ? 'opacity-40' : ''}`}
                    title={`${track.name}\n(double-click to play · drag to a playlist)`}
                  >
                    <span className="shrink-0 w-4 flex justify-center">
                      {active && isPlaying ? (
                        <span className="w-2 h-2 bg-brutal-neon animate-pulse" />
                      ) : offline ? (
                        <Unplug size={12} className="text-red-500" />
                      ) : (
                        <Music size={12} className="opacity-40" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 font-mono text-[11px] uppercase truncate">{track.name}</span>
                    <span className="shrink-0 font-mono text-[10px] opacity-40 truncate max-w-[35%] hidden sm:block">
                      {track.artist || '—'}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] opacity-50 tabular-nums">
                      {formatTime(track.duration || 0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
