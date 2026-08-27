import React from 'react';
import { FolderIcon } from './FolderIcon';
import { DesktopIcon, type IconPos } from './DesktopIcon';
import type { FolderEntry } from '../library/folderTree';

// OS-style folder icons on the desktop, one per import root (see `rootFolders()`
// — subfolders live *inside* the folder's own window). Freely positioned on the
// canvas (drag to move; positions come from App and persist). Sits above the
// wallpaper (z-1) but below opened windows. The container is pointer-events:none
// so empty gaps still reach the desktop right-click menu; each icon opts back in.
interface DesktopFoldersProps {
  folders: FolderEntry[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
}

export const DesktopFolders: React.FC<DesktopFoldersProps> = ({ folders, positions, onMove, onOpen, onContextMenu }) => {
  if (folders.length === 0) return null;
  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {folders.map((f) => {
        const id = `folder:${f.path}`;
        return (
          <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
            <FolderIcon
              path={f.path}
              caption={f.offline ? 'OFFLINE' : String(f.trackCount)}
              offline={f.offline}
              title={`${f.path}\n${f.offline ? '(offline — drive not connected)' : '(double-click to open · drag to move)'}`}
              onOpen={() => onOpen(f.path)}
              onContextMenu={(e) => onContextMenu(e, f.path)}
            />
          </DesktopIcon>
        );
      })}
    </div>
  );
};
