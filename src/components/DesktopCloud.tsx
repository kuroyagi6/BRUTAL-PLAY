import React from 'react';
import { Cloud, HardDrive, FolderOpen, EyeOff, CloudDownload } from 'lucide-react';
import type { CloudSource } from '../cloud/cloudSources';
import { DesktopIcon, type IconPos } from './DesktopIcon';

// EXPERIMENTAL cloud sources on the desktop. One tile per detected Google Drive
// account / iCloud Drive folder (see useCloudSources for why detection is
// filesystem-only).
//
// A tile is a DOORWAY, not a container: it holds no tracks and is not a drop
// target. Double-click opens the normal folder picker already inside that cloud,
// so imported songs become ordinary library tracks with ordinary desktop folders
// — this layer isn't in the playback path at all. Right-click offers the same
// import plus HIDE (display-only; it never touches the synced files).
//
// Freely positioned like the other desktop icons. The container is
// pointer-events:none so gaps still reach the desktop menu; tiles opt back in.

interface DesktopCloudProps {
  sources: CloudSource[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  /** Open the folder picker rooted at this cloud path. */
  onImport: (source: CloudSource) => void;
  onHide: (id: string) => void;
  /**
   * Open the Google Drive API window (cloud Phase 2) — reaches files that were
   * never synced to this PC. Undefined when unavailable, and never offered on
   * iCloud tiles because Apple publishes no equivalent API.
   */
  onOpenDrive?: () => void;
}

const providerIcon = (provider: CloudSource['provider'], size: number) =>
  provider === 'icloud' ? <Cloud size={size} /> : <HardDrive size={size} />;

const providerBadge = (provider: CloudSource['provider']) =>
  provider === 'icloud' ? 'iC' : 'GD';

const CloudTile: React.FC<{
  source: CloudSource;
  onImport: () => void;
  onHide: () => void;
  onOpenDrive?: () => void;
}> = ({ source, onImport, onHide, onOpenDrive }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  };

  return (
    <div className="pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group relative">
      <button
        onDoubleClick={onImport}
        onContextMenu={openMenu}
        title={`${source.displayName}\n${source.account ?? source.path}\n${source.path}\n(double-click to import music from here · right-click for options · drag to move)`}
        className="flex flex-col items-center gap-1 focus:outline-none"
      >
        <div className="relative w-14 h-14 flex items-center justify-center border-2 border-brutal-white bg-brutal-black/70 text-brutal-neon group-hover:bg-brutal-neon group-hover:text-brutal-black transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)]">
          {providerIcon(source.provider, 26)}
          <span className="absolute -bottom-1.5 -right-1.5 h-4 px-1 flex items-center justify-center bg-brutal-black border border-brutal-white text-brutal-white font-mono text-[8px]">
            {providerBadge(source.provider)}
          </span>
        </div>
        <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
          {source.displayName}
        </span>
      </button>

      {/* Inline options popover — local to the tile, like the station tiles. */}
      {menuOpen && (
        <div
          className="absolute z-10 top-1 left-1/2 -translate-x-1/2 w-44 bg-brutal-black border-2 border-brutal-neon shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] p-2 flex flex-col gap-2"
          onMouseLeave={() => setMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenuOpen(false);
          }}
        >
          <p className="font-mono text-[8px] uppercase text-brutal-white/40 leading-tight break-all">
            {source.account ?? source.path}
          </p>
          <button
            onClick={() => {
              setMenuOpen(false);
              onImport();
            }}
            className="w-full py-1 flex items-center justify-center gap-1 bg-brutal-neon text-brutal-black font-mono text-[9px] uppercase font-bold"
          >
            <FolderOpen size={11} /> IMPORT_MUSIC
          </button>
          {/* Only Google Drive has an API that can reach un-synced files. */}
          {source.provider === 'google-drive' && onOpenDrive && (
            <button
              onClick={() => {
                setMenuOpen(false);
                onOpenDrive();
              }}
              title="Browse files that are in Google Drive but not downloaded to this PC"
              className="w-full py-1 flex items-center justify-center gap-1 border border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase"
            >
              <CloudDownload size={11} /> BROWSE_ONLINE
            </button>
          )}
          <button
            onClick={() => {
              setMenuOpen(false);
              onHide();
            }}
            className="w-full py-1 flex items-center justify-center gap-1 border border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase"
          >
            <EyeOff size={11} /> HIDE_ICON
          </button>
        </div>
      )}
    </div>
  );
};

export const DesktopCloud: React.FC<DesktopCloudProps> = ({
  sources,
  positions,
  onMove,
  onImport,
  onHide,
  onOpenDrive,
}) => {
  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {sources.map((s) => (
        <DesktopIcon key={s.id} id={s.id} pos={positions[s.id] ?? { x: 16, y: 16 }} onMove={onMove}>
          <CloudTile
            source={s}
            onImport={() => onImport(s)}
            onHide={() => onHide(s.id)}
            onOpenDrive={onOpenDrive}
          />
        </DesktopIcon>
      ))}
    </div>
  );
};
