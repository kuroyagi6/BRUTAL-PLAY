import React from 'react';
import { Radio, X, Loader } from 'lucide-react';
import type { Station } from '../types';
import { DesktopIcon, type IconPos } from './DesktopIcon';

// EXPERIMENTAL internet-radio stations on the desktop. One tile per station.
// A station is a live stream, not a bucket of tracks, so there is NO track drop
// target here. Double-click plays; right-click opens a small inline popover to
// RENAME or REMOVE (kept local so this layer needs nothing from the global menu
// system). Adding a station is driven from the desktop right-click menu, which
// opens the dialog below via the `addOpen` prop — there is no "+" tile.
//
// Freely positioned on the canvas (drag to move; positions from App, persisted).
// Container is pointer-events:none so gaps still reach the desktop menu; tiles opt
// back in. Sits at the same z-layer as the other desktop icons.

interface DesktopStationsProps {
  stations: Station[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  /** Play a station (double-click). */
  onOpen: (id: string) => void;
  onAdd: (name: string, streamUrl: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** The add-station dialog is controlled by App (opened from the desktop menu). */
  addOpen: boolean;
  onCloseAdd: () => void;
  /** Id of the station currently playing, for the LIVE highlight. */
  currentStationId: string | null;
  playing: boolean;
  connecting: boolean;
}

const StationTile: React.FC<{
  station: Station;
  live: boolean;
  connecting: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}> = ({ station, live, connecting, onOpen, onRemove, onRename }) => {
  // 'menu' = rename/remove popover; 'confirm' = remove confirmation.
  const [mode, setMode] = React.useState<null | 'menu' | 'confirm'>(null);
  const [name, setName] = React.useState(station.name);
  const [brokenFavicon, setBrokenFavicon] = React.useState(false);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setName(station.name);
    setMode('menu');
  };
  const saveName = () => {
    onRename(name);
    setMode(null);
  };

  const showFavicon = station.faviconUrl && !brokenFavicon;

  return (
    <div className="pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group relative">
      <button
        onDoubleClick={onOpen}
        onContextMenu={openMenu}
        title={`${station.name}\n${station.streamUrl}\n(double-click to play · right-click to rename/remove · drag to move)`}
        className="flex flex-col items-center gap-1 focus:outline-none"
      >
        <div
          className={`relative w-14 h-14 flex items-center justify-center border-2 transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)] ${
            live
              ? 'border-brutal-neon bg-brutal-neon text-brutal-black'
              : 'border-brutal-white bg-brutal-black/70 text-brutal-neon group-hover:bg-brutal-neon group-hover:text-brutal-black'
          }`}
        >
          {showFavicon ? (
            <img
              src={station.faviconUrl}
              alt=""
              className="w-8 h-8 object-contain"
              onError={() => setBrokenFavicon(true)}
            />
          ) : connecting ? (
            <Loader size={24} className="animate-spin" />
          ) : (
            <Radio size={26} />
          )}
          {live && (
            <span className="absolute -bottom-1.5 -right-1.5 h-4 px-1 flex items-center justify-center bg-brutal-black border border-brutal-neon text-brutal-neon font-mono text-[8px] animate-pulse">
              LIVE
            </span>
          )}
        </div>
        <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
          {station.name}
        </span>
      </button>

      {/* Inline rename/remove popover — local to the tile, no global menu needed. */}
      {mode === 'menu' && (
        <div
          className="absolute z-10 top-1 left-1/2 -translate-x-1/2 w-44 bg-brutal-black border-2 border-brutal-neon shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] p-2 flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') setMode(null);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onFocus={(e) => e.target.select()}
            className="w-full px-2 py-1 bg-brutal-black border border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-[10px] text-brutal-white uppercase"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setMode(null)}
              className="flex-1 py-1 border border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase"
            >
              CANCEL
            </button>
            <button
              onClick={saveName}
              className="flex-1 py-1 bg-brutal-neon text-brutal-black font-mono text-[9px] uppercase font-bold"
            >
              SAVE
            </button>
          </div>
          <button
            onClick={() => setMode('confirm')}
            className="w-full py-1 border border-red-500/60 text-red-400 hover:bg-red-500 hover:text-white font-mono text-[9px] uppercase transition-colors"
          >
            REMOVE
          </button>
        </div>
      )}

      {mode === 'confirm' && (
        <div className="absolute z-10 top-1 left-1/2 -translate-x-1/2 w-40 bg-brutal-black border-2 border-red-500 shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] p-2 flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase text-brutal-white/70 leading-tight break-words">
            REMOVE_STATION?
            <br />
            <span className="text-brutal-white">{station.name}</span>
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setMode(null)}
              className="flex-1 py-1 border border-brutal-white/30 hover:border-brutal-neon font-mono text-[9px] uppercase"
            >
              KEEP
            </button>
            <button
              onClick={() => {
                setMode(null);
                onRemove();
              }}
              className="flex-1 py-1 bg-red-500 text-white font-mono text-[9px] uppercase"
            >
              REMOVE
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AddStationDialog: React.FC<{
  onAdd: (name: string, streamUrl: string) => void;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const urlRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const submit = () => {
    if (!url.trim()) {
      urlRef.current?.focus();
      return;
    }
    onAdd(name, url);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-brutal-black/80 backdrop-blur-sm pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-brutal-black border-4 border-brutal-neon shadow-[10px_10px_0px_0px_var(--brutal-shadow-color)] p-5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl uppercase flex items-center gap-2">
            <Radio size={18} className="text-brutal-neon" /> NEW_STATION
          </h2>
          <button onClick={onClose} className="text-brutal-white/50 hover:text-brutal-neon">
            <X size={18} />
          </button>
        </div>

        <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">NAME</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="MY_STATION"
          className="w-full mb-3 px-3 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-sm text-brutal-white"
        />

        <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">STREAM_URL</label>
        <input
          ref={urlRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://stream.example.com/radio.mp3"
          className="w-full mb-4 px-3 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-sm text-brutal-white"
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border-2 border-brutal-white/30 hover:border-brutal-neon font-mono text-xs uppercase"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            className="flex-1 py-2 bg-brutal-neon text-brutal-black border-2 border-brutal-black font-mono text-xs uppercase font-bold"
          >
            ADD
          </button>
        </div>
        <p className="font-mono text-[9px] text-brutal-white/30 uppercase mt-3 text-center">
          EXPERIMENTAL // DIRECT_STREAM_URL (MP3/AAC/OGG). NO_SEEK — LIVE_ONLY.
        </p>
      </div>
    </div>
  );
};

export const DesktopStations: React.FC<DesktopStationsProps> = ({
  stations,
  positions,
  onMove,
  onOpen,
  onAdd,
  onRemove,
  onRename,
  addOpen,
  onCloseAdd,
  currentStationId,
  playing,
  connecting,
}) => {
  return (
    <>
      <div className="absolute inset-0 z-[1] pointer-events-none">
        {stations.map((s) => {
          const id = `station:${s.id}`;
          return (
            <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
              <StationTile
                station={s}
                live={currentStationId === s.id && playing}
                connecting={currentStationId === s.id && connecting}
                onOpen={() => onOpen(s.id)}
                onRemove={() => onRemove(s.id)}
                onRename={(name) => onRename(s.id, name)}
              />
            </DesktopIcon>
          );
        })}
      </div>

      {addOpen && <AddStationDialog onAdd={onAdd} onClose={onCloseAdd} />}
    </>
  );
};
