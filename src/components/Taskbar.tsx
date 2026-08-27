import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Disc } from 'lucide-react';
import type { Track } from '../types';
import { useI18n } from '../i18n/LanguageContext';

export interface TaskbarWindow {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  minimized: boolean;
}

export interface TaskbarNowPlaying {
  track: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  seek: (time: number) => void;
  /** Launch/restore/minimize the Active Deck — the whole widget is its taskbar
   *  chip (transport + scrubber opt out so they keep their own behavior). */
  onToggleDeck: () => void;
  /** Deck open AND not minimized → the widget lights up in the accent color. */
  deckActive: boolean;
}

interface TaskbarProps {
  windows: TaskbarWindow[];
  /** Launch (if closed) / restore (if minimized) / minimize (if visible). */
  onSelect: (id: string) => void;
  nowPlaying: TaskbarNowPlaying;
  /** Open the system/Start menu, anchored just above the given screen point. */
  onStart: (x: number, y: number) => void;
}

function Clock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <span className="font-mono text-xs text-brutal-neon tabular-nums">
      {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
    </span>
  );
}

const icon = (node: React.ReactNode, size: number) =>
  React.isValidElement(node) ? React.cloneElement(node as React.ReactElement<{ size?: number }>, { size }) : node;

// Compact transport + track readout AND the Active Deck's taskbar chip: the
// whole widget toggles the deck (launch/restore/minimize) and lights up in the
// accent color while the deck is showing. The transport buttons and the
// scrubber call stopPropagation so a click on a control does its own thing and
// never bubbles up to the deck toggle.
function NowPlaying({
  track, isPlaying, progress, duration, togglePlay, playNext, playPrev, seek, onToggleDeck, deckActive,
}: TaskbarNowPlaying) {
  const { t } = useI18n();
  const hasTrack = !!track;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;

  const onSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)) * duration);
  };

  // Controls opt out of the deck toggle: run the action, swallow the bubble.
  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  // When active, the widget's `color` is set to --brutal-on-accent (a contrast-
  // safe fg computed from the live accent in App), and children inherit it —
  // Tailwind's preflight makes buttons inherit color, and lucide icons draw in
  // currentColor. So text/icons stay legible whatever the accent turns out to be.
  const tBtn = `p-1 transition-colors disabled:opacity-30 ${
    deckActive ? 'enabled:hover:opacity-60' : 'text-brutal-white enabled:hover:text-brutal-neon'
  }`;

  return (
    <div
      onClick={onToggleDeck}
      title={deckActive ? `${t('tb.minimize')}_${t('win.player')}` : t('tb.openDeck')}
      style={deckActive ? { color: 'var(--brutal-on-accent)' } : undefined}
      className={`flex items-center gap-2 px-2 border-r-4 border-brutal-white shrink-0 cursor-pointer transition-colors ${
        deckActive ? 'bg-brutal-neon' : 'text-brutal-white hover:bg-brutal-white/5'
      }`}
    >
      {/* cover — border follows currentColor (on-accent) when active */}
      <div className={`w-9 h-9 border-2 bg-brutal-black overflow-hidden shrink-0 flex items-center justify-center ${
        deckActive ? 'border-current' : 'border-brutal-white'
      }`}>
        {track?.coverUrl ? (
          <img src={track.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Disc size={14} className={deckActive ? 'opacity-40' : `text-brutal-white/30 ${isPlaying ? 'animate-spin-slow' : ''}`} />
        )}
      </div>

      {/* transport — each control swallows the click so it doesn't toggle the deck */}
      <div className="flex items-center">
        <button onClick={guard(playPrev)} disabled={!hasTrack} className={tBtn} title={t('tip.prev')}>
          <SkipBack size={14} />
        </button>
        <button onClick={guard(togglePlay)} disabled={!hasTrack} className={tBtn} title={t('tip.playPause')}>
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button onClick={guard(playNext)} disabled={!hasTrack} className={tBtn} title={t('tip.next')}>
          <SkipForward size={14} />
        </button>
      </div>

      {/* title + mini scrubber — inherit currentColor when active */}
      <div className="min-w-0 w-[150px] hidden lg:block">
        <p className={`font-mono text-[10px] uppercase truncate leading-none ${deckActive ? '' : 'text-brutal-white'}`} title={track?.name}>
          {track?.name || t('noSignal')}
        </p>
        <p className={`font-mono text-[9px] uppercase truncate leading-none mt-0.5 ${deckActive ? 'opacity-60' : 'text-brutal-white/40'}`}>
          {track?.artist || '—'}
        </p>
        <div
          className={`mt-1 h-1.5 relative ${deckActive ? 'bg-black/25' : 'bg-brutal-white/15'} ${hasTrack ? 'cursor-pointer' : ''}`}
          onClick={hasTrack ? onSeekClick : (e) => e.stopPropagation()}
          title={t('tip.seek')}
        >
          <div className={deckActive ? 'h-full bg-current' : 'h-full bg-brutal-neon'} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export const Taskbar: React.FC<TaskbarProps> = ({ windows, onSelect, nowPlaying, onStart }) => {
  const { t } = useI18n();
  const openCount = windows.filter((w) => w.open).length;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pb-3 px-3 pointer-events-none">
      <div className="pointer-events-auto flex items-stretch max-w-full bg-brutal-black border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)]">
        {/* Start button — opens the system menu just above the chip */}
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onStart(r.left, r.top - 8);
          }}
          title={t('start')}
          className="flex items-center px-3 border-r-4 border-brutal-white bg-brutal-white text-brutal-black shrink-0 hover:bg-brutal-neon transition-colors cursor-pointer"
        >
          <span className="font-display text-lg tracking-tighter uppercase leading-none">{t('os')}</span>
        </button>

        {/* Now playing / transport */}
        <NowPlaying {...nowPlaying} />

        {/* Window launcher / switcher */}
        <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto custom-scrollbar">
          {windows.map((w) => {
            const active = w.open && !w.minimized;
            const title = w.open
              ? w.minimized
                ? `${t('tb.restore')}_${w.title}`
                : `${t('tb.minimize')}_${w.title}`
              : `${t('tb.launch')}_${w.title}`;
            return (
              <button
                key={w.id}
                onClick={() => onSelect(w.id)}
                title={title}
                className={`relative flex items-center justify-center p-2 border-2 transition-colors shrink-0 ${
                  active
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : w.open
                    ? 'border-brutal-white/60 text-brutal-white hover:border-brutal-neon'
                    : 'border-dashed border-brutal-white/20 text-brutal-white/40 hover:text-brutal-white hover:border-brutal-white/50'
                }`}
              >
                {icon(w.icon, 18)}
                {/* running indicator, tucked in the corner */}
                <span
                  className={`absolute bottom-[3px] right-[3px] w-1.5 h-1.5 ${
                    w.open ? 'bg-current' : 'border border-current bg-transparent'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Status + clock */}
        <div className="flex items-center gap-3 px-3 border-l-4 border-brutal-white shrink-0 ml-auto">
          <span className="font-mono text-[10px] text-brutal-white/40 uppercase hidden md:inline">
            {openCount}_{t('active')}
          </span>
          <Clock />
        </div>
      </div>
    </div>
  );
};
