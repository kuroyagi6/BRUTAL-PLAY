import React from 'react';
import { Folder, FolderOpen, Music, Disc3, Library, Radio, FolderHeart, HardDrive, Unplug, type LucideIcon } from 'lucide-react';
import { folderLabel, useFolderAliases } from '../library/folderAliases';

// One folder icon. Shared by the desktop (DesktopFolders) and the inside of an
// explorer window (FolderWindow) so a folder looks the same wherever it appears.

const ICONS = [Folder, FolderOpen, Music, Disc3, Library, Radio, FolderHeart, HardDrive];
const COLORS = ['var(--brutal-neon)', '#7CFF3D', '#00E5FF', '#FF5500', '#FFD400', '#FF0080', '#0055FF', '#9D00FF'];

// Stable per-path hash so each folder keeps the same icon/color across renders.
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** The lucide icon a given folder path always draws as (also used for its taskbar chip). */
export const folderIconFor = (path: string): LucideIcon => ICONS[hash(path) % ICONS.length];

export const folderColorFor = (path: string): string => COLORS[hash(path) % COLORS.length];

interface FolderIconProps {
  path: string;
  /** Line under the name: track count, "OFFLINE", "3 FOLDERS"… */
  caption: string;
  offline?: boolean;
  title?: string;
  onOpen: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const FolderIcon: React.FC<FolderIconProps> = ({ path, caption, offline, title, onOpen, onContextMenu }) => {
  const Icon = folderIconFor(path);
  const color = folderColorFor(path);
  // A user-set nickname wins over the on-disk name; subscribing here is what
  // repaints the label the instant it's renamed. The icon and colour stay keyed
  // to the PATH, so a rename never changes how the folder looks.
  useFolderAliases();
  const name = folderLabel(path);

  return (
    <button
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={title ?? path}
      className={`pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group focus:outline-none ${offline ? 'opacity-40' : ''}`}
    >
      <div
        className="relative w-14 h-14 flex items-center justify-center border-2 border-brutal-white bg-brutal-black/70 group-hover:bg-brutal-neon group-hover:text-brutal-black transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)]"
        style={{ color }}
      >
        <Icon size={28} />
        {offline && (
          <span className="absolute -top-1.5 -right-1.5 bg-brutal-black border border-red-500 text-red-500 p-0.5" title="OFFLINE">
            <Unplug size={10} />
          </span>
        )}
      </div>
      <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
        {name}
      </span>
      <span className="font-mono text-[8px] text-brutal-white/50">{caption}</span>
    </button>
  );
};
