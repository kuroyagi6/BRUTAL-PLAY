import React from 'react';
import { Disc, User } from 'lucide-react';
import type { Track } from '../types';
import { DesktopIcon, type IconPos } from './DesktopIcon';
import { pinId, pinTracks, pinCover, type PinnedNode } from '../library/pinnedNodes';
import { useOnlineArtist } from '../hooks/useOnlineArtist';
import { useArtistImages } from '../hooks/useArtistImages';

// Album + artist icons on the desktop. Unlike folders/playlists (objects the
// user made), these are pinned from the album/artist page — a library has
// hundreds of them, so the desktop shows only what was asked for.
//
// They are ordinary wire nodes: the player resolves an album/artist node to a
// queue in `playSource` just like a folder, so they chain with everything else.
//
// Container is pointer-events:none so gaps still reach the desktop menu; tiles
// opt back in. Same z-layer as the folder icons.

interface DesktopPinsProps {
  pins: PinnedNode[];
  /** The library — pins resolve their tracks/art against it. */
  tracks: Track[];
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  /** Open the album/artist page for this pin. */
  onOpen: (pin: PinnedNode) => void;
  onContextMenu: (e: React.MouseEvent, pin: PinnedNode) => void;
}

const PinTile: React.FC<{
  pin: PinnedNode;
  count: number;
  art?: string;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}> = ({ pin, count, art, onOpen, onContextMenu }) => {
  const [failed, setFailed] = React.useState(false);
  const isArtist = pin.kind === 'artist';
  React.useEffect(() => setFailed(false), [art]);

  return (
    <button
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={`${pin.key}\n${count} track${count === 1 ? '' : 's'}\n(double-click to open · drag to move · right-click to unpin)`}
      className="pointer-events-auto w-24 flex flex-col items-center gap-1 p-2 group focus:outline-none"
    >
      <div
        className={`relative w-14 h-14 flex items-center justify-center border-2 border-brutal-white bg-brutal-black/70 text-brutal-neon overflow-hidden transition-colors shadow-[3px_3px_0px_0px_var(--brutal-shadow-color)] ${
          art && !failed ? '' : 'group-hover:bg-brutal-neon group-hover:text-brutal-black'
        }`}
      >
        {art && !failed ? (
          <img
            src={art}
            alt=""
            // Artist photos are remote; album art is a local blob. Either way a
            // dead URL falls back to the icon rather than a broken image.
            onError={() => setFailed(true)}
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : isArtist ? (
          <User size={26} />
        ) : (
          <Disc size={26} />
        )}
        <span className="absolute -bottom-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-brutal-black border border-brutal-white text-brutal-white font-mono text-[8px]">
          {count}
        </span>
      </div>
      <span className="font-mono text-[9px] uppercase text-brutal-white text-center leading-tight line-clamp-2 bg-brutal-black/70 px-1">
        {pin.key}
      </span>
    </button>
  );
};

export const DesktopPins: React.FC<DesktopPinsProps> = ({
  pins,
  tracks,
  positions,
  onMove,
  onOpen,
  onContextMenu,
}) => {
  // Artist icons wear the cached artist photo when there is one; albums wear
  // their cover. Read-only — the icons never fetch (Settings fills the cache).
  const [onlineArtist] = useOnlineArtist();
  const artistImages = useArtistImages(onlineArtist);

  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {pins.map((pin) => {
        const id = pinId(pin);
        const count = pinTracks(tracks, pin).length;
        const art =
          pin.kind === 'artist'
            ? // A photo if one is cached, else art from their tracks so the icon
              // still reads as something offline.
              artistImages.get(pin.key, false) ?? pinCover(tracks, pin)
            : pinCover(tracks, pin);

        return (
          <DesktopIcon key={id} id={id} pos={positions[id] ?? { x: 16, y: 16 }} onMove={onMove}>
            <PinTile
              pin={pin}
              count={count}
              art={art}
              onOpen={() => onOpen(pin)}
              onContextMenu={(e) => onContextMenu(e, pin)}
            />
          </DesktopIcon>
        );
      })}
    </div>
  );
};
