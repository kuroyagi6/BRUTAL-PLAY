import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Play, Film, Unplug, FolderOpen } from 'lucide-react';
import type { VideoItem } from '../types';
import { breadcrumb, parentOf, readDir, samePath } from '../library/folderTree';
import { folderLabel, useFolderAliases } from '../library/folderAliases';
import { FolderIcon } from './FolderIcon';
import { formatTime } from '../utils/format';

// An explorer window over one imported video root — the video twin of
// FolderWindow. All the path/hierarchy math is the shared, tested folderTree
// (now generic), so this file only paints a directory of videos and owns the
// back/forward/up navigation. Double-clicking a video opens the video player.

interface VideoFolderWindowProps {
  /** The folder this window was opened at. Navigation never goes above it. */
  root: string;
  /** The whole video library — the current directory listing is derived from it. */
  videos: VideoItem[];
  /** Lowercased native paths currently unreachable (drive removed). */
  offlinePaths: Set<string>;
  /** The video currently loaded in the player, if any. */
  currentVideoId: string | null;
  isPlaying: boolean;
  /** Open a video in the player window. */
  onOpenVideo: (video: VideoItem) => void;
  onFolderContextMenu?: (e: React.MouseEvent, path: string) => void;
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

export const VideoFolderWindow: React.FC<VideoFolderWindowProps> = ({
  root,
  videos,
  offlinePaths,
  currentVideoId,
  isPlaying,
  onOpenVideo,
  onFolderContextMenu,
}) => {
  const [cwd, setCwd] = React.useState(root);
  const [past, setPast] = React.useState<string[]>([]);
  const [future, setFuture] = React.useState<string[]>([]);

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
    () => readDir(videos, cwd, isMissing),
    [videos, cwd, isMissing]
  );
  // Root crumb wears the folder's nickname; see FolderWindow for the reasoning.
  const aliases = useFolderAliases();
  const crumbs = React.useMemo(() => {
    const c = breadcrumb(cwd, root);
    c[0] = { ...c[0], name: folderLabel(root) };
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, root, aliases]);
  const up = parentOf(cwd, root);

  return (
    <div className="h-full flex flex-col bg-brutal-black text-brutal-white">
      {/* ─── Toolbar: history, up, breadcrumb ───────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 p-2 border-b-4 border-brutal-white bg-brutal-black">
        <div className="flex items-center gap-1 shrink-0">
          <Toolbar label="BACK" icon={<ArrowLeft size={14} strokeWidth={3} />} disabled={past.length === 0} onClick={back} />
          <Toolbar label="FORWARD" icon={<ArrowRight size={14} strokeWidth={3} />} disabled={future.length === 0} onClick={forward} />
          <Toolbar label="UP" icon={<ArrowUp size={14} strokeWidth={3} />} disabled={!up} onClick={() => up && navigate(up)} />
        </div>

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
              {folders.map((f) => (
                <FolderIcon
                  key={f.path}
                  path={f.path}
                  caption={f.offline ? 'OFFLINE' : `${f.trackCount}_VID${f.folderCount > 0 ? ` // ${f.folderCount}D` : ''}`}
                  offline={f.offline}
                  title={`${f.path}\n(double-click to open)`}
                  onOpen={() => navigate(f.path)}
                  onContextMenu={onFolderContextMenu && ((e) => onFolderContextMenu(e, f.path))}
                />
              ))}
            </div>
          </>
        )}

        {files.length > 0 && (
          <>
            <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/40 mb-2 pt-1 border-t-2 border-brutal-white/10">
              {files.length}_VIDEOS
            </p>
            <div className="space-y-1">
              {files.map((video) => {
                const active = video.id === currentVideoId;
                const offline = isMissing(video.nativePath);
                return (
                  <button
                    key={video.id}
                    onDoubleClick={() => !offline && onOpenVideo(video)}
                    className={`w-full flex items-center gap-3 px-2 py-1.5 border-2 text-left transition-colors ${
                      active
                        ? 'border-brutal-neon bg-brutal-neon/10 text-brutal-neon'
                        : 'border-transparent hover:border-brutal-white/40'
                    } ${offline ? 'opacity-40' : ''}`}
                    title={`${video.name}\n(double-click to play)`}
                  >
                    <span className="shrink-0 w-4 flex justify-center">
                      {active && isPlaying ? (
                        <span className="w-2 h-2 bg-brutal-neon animate-pulse" />
                      ) : offline ? (
                        <Unplug size={12} className="text-red-500" />
                      ) : active ? (
                        <Play size={12} className="text-brutal-neon" fill="currentColor" />
                      ) : (
                        <Film size={12} className="opacity-40" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 font-mono text-[11px] uppercase truncate">{video.name}</span>
                    {video.width && video.height && (
                      <span className="shrink-0 font-mono text-[9px] opacity-40 hidden sm:block">
                        {video.width}×{video.height}
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[10px] opacity-50 tabular-nums">
                      {video.duration ? formatTime(video.duration) : '—'}
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
