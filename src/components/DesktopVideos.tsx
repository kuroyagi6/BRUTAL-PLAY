import React from 'react';
import { Film, Clapperboard, Video, MonitorPlay, Unplug, type LucideIcon } from 'lucide-react';
import type { FolderEntry } from '../library/folderTree';
import { DesktopIcon, type IconPos } from './DesktopIcon';
import { folderLabel, useFolderAliases } from '../library/folderAliases';

// Desktop icons for imported video roots — the video twin of DesktopFolders.
// Freely positioned on the canvas (drag to move; positions from App, persisted).
// Double-click opens that folder's videos in its own explorer window. The
// container is pointer-events:none so the gaps still reach the desktop
// right-click menu; each tile opts back in.

const VIDEO_ICONS: LucideIcon[] = [Film, Clapperboard, Video, MonitorPlay];
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
export const videoIconFor = (path: string): LucideIcon => VIDEO_ICONS[hash(path) % VIDEO_ICONS.length];

const baseName = (p: string) => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return (i >= 0 ? p.slice(i + 1) : p) || p;
};

interface DesktopVideosProps {
  folders: FolderEntry[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
}

export const DesktopVideos: React.FC<DesktopVideosProps> = ({ folders, positions, onMove, onOpen, onContextMenu }) => {
  // Video roots are folder icons too, so they share the rename store.
  useFolderAliases();
  if (folders.length === 0) return null;
  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {folders.map((f) => {
        const Icon = videoIconFor(f.path);
        const id = `video:${f.path}`;
        return (
          <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
            <button
              onDoubleClick={() => onOpen(f.path)}
              onContextMenu={(e) => onContextMenu(e, f.path)}
              title={`${f.path}\n${f.offline ? '(offline — drive not connected)' : '(double-click to open · drag to move)'}`}
              className={`pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group focus:outline-none ${f.offline ? 'opacity-40' : ''}`}
            >
              <div
                className="relative w-14 h-14 flex items-center justify-center border-2 border-brutal-white bg-brutal-black/70 text-brutal-neon group-hover:bg-brutal-neon group-hover:text-brutal-black transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)]"
              >
                <Icon size={28} />
                {f.offline && (
                  <span className="absolute -top-1.5 -right-1.5 bg-brutal-black border border-red-500 text-red-500 p-0.5" title="OFFLINE">
                    <Unplug size={10} />
                  </span>
                )}
              </div>
              <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
                {folderLabel(f.path)}
              </span>
              <span className="font-mono text-[8px] text-brutal-white/50">
                {f.offline ? 'OFFLINE' : `${f.trackCount}_VID`}
              </span>
            </button>
          </DesktopIcon>
        );
      })}
    </div>
  );
};
