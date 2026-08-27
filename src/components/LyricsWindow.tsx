// The LYRICS window: everything about words on ONE screen. Replaces the old
// INSPECTOR panel, whose EQ tab duplicated the FX_RACK window.
//
//   ┌ toolbar: [STYLE]  [ search box ]  [CARD] ────────────────┐
//   │ lyrics (scrolling, follows playback) │ meanings (per line) │
//   └──────────────────────────────────────────────────────────┘
//
// No tabs: the lyrics and their meanings are the two halves of one thing and
// are always both on screen. The three toolbar controls open OVER that view and
// close again — style controls, lyric search, card export — so nothing you're
// reading is ever swapped out to reach a tool.
//
// A shell only: each panel is its own component owning its own state, so one
// can't disturb another.
import React from 'react';
import { Palette, Search, Image as ImageIcon, BookOpen, X } from 'lucide-react';
import { LyricsView } from './LyricsView';
import { LyricsSearchView } from './LyricsSearchView';
import { LyricsStyleView } from './LyricsStyleView';
import { LyricsCard } from './LyricsCard';
import { MeaningCorner } from './MeaningCorner';
import { usePlayer } from '../player/PlayerContext';
import { useElementWidth } from '../hooks/useElementWidth';
import { resolveSyncedLyrics, activeLineIndex } from '../utils/lrc';

interface LyricsWindowProps {
  isMobile?: boolean;
  /** Opens the Settings window (for the Genius token). Absent in popped-out
   *  windows, which have no window manager of their own. */
  onOpenSettings?: () => void;
}

/**
 * Below this the window is too narrow to hold two readable columns, so the
 * meanings drop underneath as a collapsible strip. Measured on the WINDOW, not
 * the screen — these panels are resized by the app's own window manager, so a
 * CSS breakpoint would describe the wrong thing (see useElementWidth).
 */
const SPLIT_AT = 620;

export const LyricsWindow: React.FC<LyricsWindowProps> = ({ isMobile = false, onOpenSettings }) => {
  const { currentTrack, progress, updateTrackDetails } = usePlayer();
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const [query, setQuery] = React.useState('');
  const [showStyle, setShowStyle] = React.useState(false);
  const [showCard, setShowCard] = React.useState(false);
  // Narrow only: which half you're looking at. Restored (small) windows can't
  // show two columns, and stacking them left the meanings as a sliver below the
  // fold — so there they swap instead, and this button is how you get across.
  const [narrowPane, setNarrowPane] = React.useState<'lyrics' | 'meanings'>('lyrics');

  const side = width >= SPLIT_AT;
  const searching = query.trim().length >= 2;
  const showMeanings = side || narrowPane === 'meanings';
  const showLyrics = side || narrowPane === 'lyrics';

  // The line playing right now — the card opens with it pre-selected.
  const synced = resolveSyncedLyrics(currentTrack);
  const activeIdx = synced ? activeLineIndex(synced, progress) : -1;

  const toolButton = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      onClick={onClick}
      title={title}
      className={`shrink-0 p-2 border-2 transition-colors ${
        active
          ? 'bg-brutal-neon text-brutal-black border-brutal-black'
          : 'border-brutal-white/30 text-brutal-white hover:border-brutal-neon'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div ref={ref} className="flex flex-col h-full bg-brutal-black text-brutal-white font-mono">
      {/* ─── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 p-2 border-b-4 border-brutal-white shrink-0">
        {toolButton(showStyle, () => { setShowStyle(!showStyle); setShowCard(false); }, 'Lyrics style', <Palette size={14} />)}

        <div className="flex-1 min-w-0 flex items-center gap-2 border-2 border-brutal-white/30 focus-within:border-brutal-neon px-2">
          <Search size={13} className="text-brutal-white/50 shrink-0" />
          <input
            value={query}
            onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
            placeholder="SEARCH LYRICS…"
            className="flex-1 min-w-0 bg-transparent py-1.5 font-mono text-xs text-brutal-white placeholder:text-brutal-white/25 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search"
              className="shrink-0 text-brutal-white/40 hover:text-brutal-neon"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {!side &&
          toolButton(
            narrowPane === 'meanings',
            () => setNarrowPane(narrowPane === 'meanings' ? 'lyrics' : 'meanings'),
            narrowPane === 'meanings' ? 'Back to lyrics' : 'Show meanings',
            <BookOpen size={14} />
          )}

        {toolButton(showCard, () => { setShowCard(!showCard); setShowStyle(false); }, 'Lyrics card', <ImageIcon size={14} />)}
      </div>

      {/* ─── Body: lyrics | meanings, with the tools layered over ────────── */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex flex-row">
          {/* Kept MOUNTED when hidden in the narrow layout, not unmounted: the
              lyrics view owns the scroll position that follows playback, and
              remounting it on every swap would jump the song back to the top. */}
          <div className={`${side ? 'flex-1 min-w-0' : showLyrics ? 'flex-1 min-w-0' : 'hidden'} overflow-hidden`}>
            <LyricsView
              currentTrack={currentTrack}
              progress={progress}
              updateTrackDetails={updateTrackDetails}
            />
          </div>

          <div
            className={
              side
                ? 'w-[38%] max-w-[420px] min-w-[220px] border-l-4 border-brutal-white overflow-hidden'
                : showMeanings
                  ? 'flex-1 min-w-0 overflow-hidden'
                  : 'hidden'
            }
          >
            <MeaningCorner
              currentTrack={currentTrack}
              progress={progress}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>

        {/* Search results take over the reading area while there's a query —
            typing is itself the "open", and clearing it is the close. */}
        {searching && (
          <div className="absolute inset-0 z-20 bg-brutal-black">
            <LyricsSearchView query={query} onOpened={() => setQuery('')} />
          </div>
        )}

        {showStyle && (
          <div className="absolute inset-0 z-30 bg-brutal-black flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b-4 border-brutal-white shrink-0">
              <span className="font-mono text-[11px] uppercase tracking-tighter flex items-center gap-2">
                <Palette size={13} className="text-brutal-neon" /> LYRICS_STYLE
              </span>
              <button
                onClick={() => setShowStyle(false)}
                className="p-1 border-2 border-brutal-white hover:bg-brutal-white/10"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <LyricsStyleView />
            </div>
          </div>
        )}

        {showCard && (
          <LyricsCard
            currentTrack={currentTrack}
            activeIndex={activeIdx}
            onClose={() => setShowCard(false)}
          />
        )}
      </div>
    </div>
  );
};
