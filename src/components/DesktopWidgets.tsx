import React from 'react';
import { Radar, ExternalLink, Search, Music, Loader2, ChevronRight } from 'lucide-react';
import { DesktopIcon, type IconPos } from './DesktopIcon';
import { youtubeSearchUrl, type SuggestedTrack } from '../services/recommend';
import type { UseRadar } from '../hooks/useRadar';

// Desktop widgets: live cards that sit on the canvas next to the icons.
//
// A widget is a DesktopIcon with a bigger child — it reuses that wrapper rather
// than growing its own drag code, so widgets are movable, clamped to the desktop
// and immune to the native-image-drag bug for free, and there is exactly one
// pointer-drag implementation on the desktop.
//
// Container is pointer-events:none so gaps still reach the desktop right-click
// menu; each card opts back in. Same z-layer as the icons.
//
// This layer READS a report. It never scans: a scan is dozens of requests and
// belongs to an explicit button in the RADAR window, not to something that
// happens because the desktop rendered.

export const RADAR_WIDGET_ID = 'widget:radar';

/** Ids of every widget currently on the desktop — App uses these for layout slots. */
export function widgetIds(radarEnabled: boolean): string[] {
  return radarEnabled ? [RADAR_WIDGET_ID] : [];
}

const PEEK = 3; // suggestions shown on the card; the window has the full list

const MiniRow: React.FC<{ track: SuggestedTrack }> = React.memo(
  ({ track }: { track: SuggestedTrack }) => (
    <div className="flex items-center gap-2 group/row">
      <div className="w-7 h-7 border border-brutal-white/40 overflow-hidden shrink-0 flex items-center justify-center">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="w-full h-full object-cover grayscale group-hover/row:grayscale-0 transition-all"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Music size={12} className="opacity-30" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[9px] uppercase truncate text-brutal-white leading-tight">
          {track.title}
        </p>
        <p className="font-mono text-[8px] uppercase truncate text-brutal-white/40 leading-tight">
          {track.artist}
        </p>
      </div>
      {track.link && (
        <a
          href={track.link}
          target="_blank"
          rel="noreferrer"
          title="Open on Deezer"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="p-1 text-brutal-white/30 hover:text-brutal-neon transition-colors shrink-0"
        >
          <ExternalLink size={11} />
        </a>
      )}
      <a
        href={youtubeSearchUrl(track)}
        target="_blank"
        rel="noreferrer"
        title="Search YouTube"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="p-1 text-brutal-white/30 hover:text-brutal-neon transition-colors shrink-0"
      >
        <Search size={11} />
      </a>
    </div>
  )
);

interface RadarWidgetProps {
  radar: UseRadar;
  /** Open the full RADAR window. */
  onOpen: () => void;
}

// The card itself. Double-click (like every other desktop object) opens the
// window; the header button does too, for discoverability.
const RadarWidget: React.FC<RadarWidgetProps> = ({ radar, onOpen }: RadarWidgetProps) => {
  const { visible, scanning, progress, report } = radar;
  const peek = visible.tracks.slice(0, PEEK);

  return (
    <div
      onDoubleClick={onOpen}
      title="RADAR — double-click to open the full report"
      className="pointer-events-auto w-64 bg-brutal-black/80 border-2 border-brutal-white shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] p-2.5 space-y-2 cursor-move select-none"
    >
      <div className="flex items-center gap-2">
        {scanning ? (
          <Loader2 size={13} className="text-brutal-neon animate-spin shrink-0" />
        ) : (
          <Radar size={13} className="text-brutal-neon shrink-0" />
        )}
        <p className="font-display text-[11px] uppercase tracking-tighter text-brutal-white flex-1 truncate">
          RADAR
        </p>
        <button
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Open the RADAR window"
          className="text-brutal-white/40 hover:text-brutal-neon transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {scanning && progress ? (
        <div className="space-y-1">
          <p className="font-mono text-[8px] uppercase text-brutal-neon truncate">
            {progress.current}
          </p>
          <div className="h-1 bg-brutal-white/10">
            <div
              className="h-full bg-brutal-neon transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : !report ? (
        <p className="font-mono text-[8px] uppercase text-brutal-white/40 leading-relaxed">
          NO_SCAN_YET — OPEN TO SCAN YOUR LIBRARY
        </p>
      ) : peek.length === 0 ? (
        <p className="font-mono text-[8px] uppercase text-brutal-white/40">NOTHING_MISSING</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {peek.map((t) => (
              <MiniRow key={t.id} track={t} />
            ))}
          </div>
          {visible.tracks.length > PEEK && (
            <p className="font-mono text-[8px] uppercase text-brutal-white/30 pt-1 border-t border-brutal-white/10">
              +{visible.tracks.length - PEEK} MORE // {visible.artists.length} NEW ARTIST
              {visible.artists.length === 1 ? '' : 'S'}
            </p>
          )}
        </>
      )}
    </div>
  );
};

interface DesktopWidgetsProps {
  radarEnabled: boolean;
  radar: UseRadar;
  positions: Record<string, IconPos>;
  onMove: (id: string, pos: IconPos) => void;
  onOpenRadar: () => void;
}

export const DesktopWidgets: React.FC<DesktopWidgetsProps> = ({
  radarEnabled,
  radar,
  positions,
  onMove,
  onOpenRadar,
}: DesktopWidgetsProps) => {
  if (!radarEnabled) return null;
  return (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      <DesktopIcon
        id={RADAR_WIDGET_ID}
        pos={positions[RADAR_WIDGET_ID] ?? { x: 16, y: 16 }}
        onMove={onMove}
      >
        <RadarWidget radar={radar} onOpen={onOpenRadar} />
      </DesktopIcon>
    </div>
  );
};
