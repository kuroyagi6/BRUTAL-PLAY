import React from 'react';
import { Youtube, ListVideo, X } from 'lucide-react';
import type { YouTubeItem } from '../types';
import { parseYouTube, youTubeThumb } from '../utils/youtube';
import { DesktopIcon, type IconPos } from './DesktopIcon';

// EXPERIMENTAL YouTube desktop icons — the YouTube twin of DesktopStations. One
// tile per saved video/playlist (video tiles show the real YouTube thumbnail).
// Double-click opens the embedded player window; right-click opens an inline
// rename/remove popover. Adding is driven from the desktop right-click menu
// (NEW_YOUTUBE) via the `addOpen` prop — there is no "+" tile.
//
// Container is pointer-events:none so gaps still reach the desktop menu; tiles opt
// back in. Same z-layer as the other desktop icons.

interface DesktopYouTubeProps {
  items: YouTubeItem[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  onOpen: (id: string) => void;
  onAdd: (name: string, urlOrId: string) => boolean;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  addOpen: boolean;
  onCloseAdd: () => void;
  /** Id of the item currently in the player window, for the PLAYING highlight. */
  currentItemId: string | null;
}

const YouTubeTile: React.FC<{
  item: YouTubeItem;
  live: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}> = ({ item, live, onOpen, onRemove, onRename }) => {
  const [mode, setMode] = React.useState<null | 'menu' | 'confirm'>(null);
  const [name, setName] = React.useState(item.name);
  const [brokenThumb, setBrokenThumb] = React.useState(false);

  const thumb = youTubeThumb(item);
  const showThumb = thumb && !brokenThumb;

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setName(item.name);
    setMode('menu');
  };
  const saveName = () => {
    onRename(name);
    setMode(null);
  };

  return (
    <div className="pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group relative">
      <button
        onDoubleClick={onOpen}
        onContextMenu={openMenu}
        title={`${item.name}\n${item.kind === 'playlist' ? 'PLAYLIST' : 'VIDEO'}\n(double-click to play · right-click to rename/remove · drag to move)`}
        className="flex flex-col items-center gap-1 focus:outline-none"
      >
        <div
          className={`relative w-14 h-14 flex items-center justify-center border-2 overflow-hidden transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)] ${
            live
              ? 'border-brutal-neon bg-brutal-neon text-brutal-black'
              : 'border-brutal-white bg-brutal-black/70 text-brutal-neon group-hover:bg-brutal-neon group-hover:text-brutal-black'
          }`}
        >
          {showThumb ? (
            <img
              src={thumb}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setBrokenThumb(true)}
            />
          ) : item.kind === 'playlist' ? (
            <ListVideo size={26} />
          ) : (
            <Youtube size={26} />
          )}
          {/* kind badge */}
          <span className="absolute -bottom-1.5 -right-1.5 h-4 px-1 flex items-center justify-center bg-brutal-black border border-brutal-white text-brutal-white font-mono text-[7px]">
            {item.kind === 'playlist' ? 'LIST' : 'VID'}
          </span>
          {live && (
            <span className="absolute top-0 left-0 h-3.5 px-1 flex items-center justify-center bg-brutal-neon text-brutal-black font-mono text-[7px] animate-pulse">
              ▶
            </span>
          )}
        </div>
        <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
          {item.name}
        </span>
      </button>

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
            REMOVE?
            <br />
            <span className="text-brutal-white">{item.name}</span>
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

const AddYouTubeDialog: React.FC<{
  onAdd: (name: string, urlOrId: string) => boolean;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const urlRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    urlRef.current?.focus();
  }, []);

  // Live-parse so we can preview the kind and disable ADD on garbage.
  const parsed = React.useMemo(() => parseYouTube(url), [url]);

  const submit = () => {
    if (!onAdd(name, url)) {
      setInvalid(true);
      urlRef.current?.focus();
      return;
    }
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
            <Youtube size={18} className="text-brutal-neon" /> NEW_YOUTUBE
          </h2>
          <button onClick={onClose} className="text-brutal-white/50 hover:text-brutal-neon">
            <X size={18} />
          </button>
        </div>

        <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">NAME</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="MY_SONG"
          className="w-full mb-3 px-3 py-2 bg-brutal-black border-2 border-brutal-white/30 focus:border-brutal-neon outline-none font-mono text-sm text-brutal-white"
        />

        <label className="block font-mono text-[10px] uppercase text-brutal-white/50 mb-1">
          YOUTUBE_URL
        </label>
        <input
          ref={urlRef}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setInvalid(false);
          }}
          placeholder="https://youtube.com/watch?v=... or playlist?list=..."
          className={`w-full px-3 py-2 bg-brutal-black border-2 outline-none font-mono text-sm text-brutal-white ${
            invalid ? 'border-red-500' : 'border-brutal-white/30 focus:border-brutal-neon'
          }`}
        />
        {/* Live feedback: what we detected, or an error. */}
        <div className="h-4 mt-1 mb-3 font-mono text-[9px] uppercase">
          {invalid ? (
            <span className="text-red-400">NOT_A_YOUTUBE_LINK</span>
          ) : parsed ? (
            <span className="text-brutal-neon">
              DETECTED // {parsed.kind === 'playlist' ? 'PLAYLIST' : 'VIDEO'}
            </span>
          ) : (
            <span className="text-brutal-white/30">PASTE A VIDEO OR PLAYLIST LINK</span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border-2 border-brutal-white/30 hover:border-brutal-neon font-mono text-xs uppercase"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!parsed}
            className="flex-1 py-2 bg-brutal-neon text-brutal-black border-2 border-brutal-black font-mono text-xs uppercase font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ADD
          </button>
        </div>
        <p className="font-mono text-[9px] text-brutal-white/30 uppercase mt-3 text-center leading-tight">
          EXPERIMENTAL // PLAYS IN YOUTUBE'S PLAYER. NO_EQ/VISUALIZER (IFRAME AUDIO).
        </p>
      </div>
    </div>
  );
};

export const DesktopYouTube: React.FC<DesktopYouTubeProps> = ({
  items,
  positions,
  onMove,
  onOpen,
  onAdd,
  onRemove,
  onRename,
  addOpen,
  onCloseAdd,
  currentItemId,
}) => {
  return (
    <>
      <div className="absolute inset-0 z-[1] pointer-events-none">
        {items.map((it) => {
          const id = `youtube:${it.id}`;
          return (
            <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
              <YouTubeTile
                item={it}
                live={currentItemId === it.id}
                onOpen={() => onOpen(it.id)}
                onRemove={() => onRemove(it.id)}
                onRename={(name) => onRename(it.id, name)}
              />
            </DesktopIcon>
          );
        })}
      </div>

      {addOpen && <AddYouTubeDialog onAdd={onAdd} onClose={onCloseAdd} />}
    </>
  );
};
