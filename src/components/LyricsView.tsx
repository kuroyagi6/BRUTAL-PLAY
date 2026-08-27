import React, { useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import {
  FileText, UploadCloud, DownloadCloud, Timer, Pencil, Check, X, ChevronLeft,
  Globe, RefreshCw, WifiOff,
} from 'lucide-react';
import { motion } from 'motion/react';
import { formatTime } from '../utils/format';
import { parseTimestampedLyrics, resolveSyncedLyrics, activeLineIndex } from '../utils/lrc';
import { useOnlineLyrics, useAutoLyrics } from '../hooks/useOnlineLyrics';
import { useLyricsFetch } from '../hooks/useLyricsFetch';
import { useLyricsStyle, lineClass, lineStyle, ALIGN_CLASS, FONT_CLASS, BG_CLASS } from '../hooks/useLyricsStyle';
import { usePlayer } from '../player/PlayerContext';

interface LyricsViewProps {
  currentTrack: Track | null;
  progress: number;
  updateTrackDetails?: (id: string, updates: Partial<Track>) => void;
}

type Mode = 'view' | 'paste' | 'sync';

export const LyricsView: React.FC<LyricsViewProps> = ({ currentTrack, progress, updateTrackDetails }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState('');

  // Tap-along sync state: the lines being timed, the current line, and the
  // timestamp captured for each so far. `progress` is read live on each tap.
  const [syncLines, setSyncLines] = useState<string[]>([]);
  const [syncIdx, setSyncIdx] = useState(0);
  const [syncStamps, setSyncStamps] = useState<number[]>([]);

  const { lyrics, syncedLyrics } = currentTrack || {};

  // Resolved ONCE, up here, because the auto-scroll below needs the same lines
  // the view renders. It used to watch `syncedLyrics` alone, so a track whose
  // timestamps live inside plain `lyrics` (very common — USLT tags with [mm:ss]
  // tokens) highlighted its lines but never scrolled to them, leaving you to
  // chase the song down the page by hand.
  const displaySynced = React.useMemo(
    () => resolveSyncedLyrics(currentTrack),
    [currentTrack?.lyrics, currentTrack?.syncedLyrics]
  );
  const activeIndex = displaySynced ? activeLineIndex(displaySynced, progress) : -1;

  // Online lookup (LRCLIB). Off until opted in — a lookup sends the title +
  // artist to a third party. `auto` additionally fetches on track change; both
  // write through the same updateTrackDetails seam the paste box uses, so the
  // views below need no special case for "fetched" lyrics.
  const [onlineLyrics, setOnlineLyrics] = useOnlineLyrics();
  const [autoLyrics] = useAutoLyrics();
  const fetcher = useLyricsFetch(currentTrack, onlineLyrics, autoLyrics, updateTrackDetails);

  // Presentation (font/size/dim/glow) comes from the STYLE panel. Read from the
  // hook rather than passed down, so a popped-out lyrics window restyles live.
  const { style } = useLyricsStyle();
  // Only for click-to-seek; the transport is otherwise none of this view's
  // business, and `progress` still arrives as a prop.
  const { seek } = usePlayer();

  // Leaving a track resets any in-progress edit so it can't bleed across songs.
  useEffect(() => {
    setMode('view');
  }, [currentTrack?.id]);

  // Keep the playing line centred. Scrolls the CONTAINER by offset rather than
  // calling scrollIntoView: that walks up and scrolls every scrollable ancestor
  // it finds, which in a window manager made of nested scroll panes drags the
  // whole panel around. Keyed on the line index, not `progress`, so it fires
  // once per line instead of several times a second.
  useEffect(() => {
    if (mode !== 'view' || activeIndex < 0) return;
    const container = containerRef.current;
    const line = activeLineRef.current;
    if (!container || !line) return;
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex, mode]);

  const handleLRCImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentTrack || !updateTrackDetails) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const synced = parseTimestampedLyrics(e.target?.result as string);
      if (synced.length > 0) updateTrackDetails(currentTrack.id, { syncedLyrics: synced });
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Sync mode ──────────────────────────────────────────────────────────────
  const beginSync = () => {
    // Seed from the plain lyrics, or re-sync from existing synced line texts.
    const source = lyrics ?? (syncedLyrics ? syncedLyrics.map((l) => l.text).join('\n') : '');
    const lines = source.split('\n').map((l) => l.trim()).filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
    setSyncLines(lines);
    setSyncIdx(0);
    setSyncStamps([]);
    setMode('sync');
  };

  const stampLine = () => {
    setSyncStamps((prev) => {
      const next = [...prev];
      next[syncIdx] = progress;
      return next;
    });
    setSyncIdx((i) => Math.min(i + 1, syncLines.length));
  };

  const undoStamp = () => setSyncIdx((i) => Math.max(0, i - 1));

  const commitSync = () => {
    if (!currentTrack || !updateTrackDetails) return;
    const synced = syncLines
      .slice(0, syncIdx)
      .map((text, i) => ({ text, timestamp: syncStamps[i] ?? 0 }))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (synced.length > 0) updateTrackDetails(currentTrack.id, { syncedLyrics: synced });
    setMode('view');
  };

  // Enter (or the on-screen button) stamps the current line. Enter isn't a global
  // shortcut, but stop it here anyway so nothing else reacts while syncing.
  useEffect(() => {
    if (mode !== 'sync') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); stampLine(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMode('view'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, syncIdx, syncLines, progress]);

  // Rendered as {headerActions()} (a plain call, NOT <HeaderActions/>) so it
  // reconciles in place — a nested component would remount every progress tick
  // and make the buttons flicker.
  const headerActions = () => {
    if (!updateTrackDetails || mode !== 'view') return null;
    const hasAny = !!(lyrics || (syncedLyrics && syncedLyrics.length));
    return (
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <input type="file" ref={fileInputRef} className="hidden" accept=".lrc" onChange={handleLRCImport} />
        {onlineLyrics && fetcher.canFetch && (
          <button
            onClick={fetcher.fetchNow}
            disabled={fetcher.status === 'loading'}
            title={hasAny ? 'Re-fetch synced lyrics from LRCLIB' : 'Fetch synced lyrics from LRCLIB'}
            className="p-2 bg-brutal-black text-brutal-white border-2 border-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors disabled:opacity-40"
          >
            {fetcher.status === 'loading'
              ? <RefreshCw size={16} className="animate-spin" />
              : <DownloadCloud size={16} />}
          </button>
        )}
        {hasAny && (
          <button onClick={beginSync} title="Tap-to-sync lyrics"
            className="p-2 bg-brutal-black text-brutal-white border-2 border-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors">
            <Timer size={16} />
          </button>
        )}
        <button onClick={() => { setDraft(lyrics ?? ''); setMode('paste'); }} title="Paste / edit lyrics"
          className="p-2 bg-brutal-black text-brutal-white border-2 border-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors">
          <Pencil size={16} />
        </button>
        <button onClick={() => fileInputRef.current?.click()} title="Import .LRC file"
          className="p-2 bg-brutal-black text-brutal-white border-2 border-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors">
          <UploadCloud size={16} />
        </button>
      </div>
    );
  };

  if (!currentTrack) {
    return (
      <div className="h-full flex items-center justify-center text-brutal-white/30 font-mono text-sm p-4 text-center">
        NO_SIGNAL_DETECTED
      </div>
    );
  }

  const trackHead = () => {
    if (!style.header) return null;
    return (
      <div className={`${ALIGN_CLASS[style.align]} mb-6`}>
        <h3 className="font-display text-xl text-brutal-neon uppercase tracking-tighter">{currentTrack.name}</h3>
        <p className="font-mono text-xs text-brutal-white/50">{currentTrack.artist}</p>
      </div>
    );
  };

  // ─── PASTE / EDIT ───────────────────────────────────────────────────────────
  if (mode === 'paste') {
    return (
      <div className="h-full flex flex-col p-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="font-display uppercase tracking-tighter text-brutal-white">PASTE_LYRICS</span>
          <div className="flex gap-2">
            <button onClick={() => setMode('view')} className="p-2 border-2 border-brutal-white text-brutal-white hover:bg-brutal-white/10" title="Cancel"><X size={16} /></button>
            <button
              onClick={() => {
                // Pasted text with [mm:ss] tokens → synced (and follows playback);
                // otherwise plain lyrics. Either way, clear the other form.
                const synced = parseTimestampedLyrics(draft);
                updateTrackDetails?.(currentTrack.id, synced.length > 0
                  ? { syncedLyrics: synced, lyrics: undefined }
                  : { lyrics: draft, syncedLyrics: undefined });
                setMode('view');
              }}
              className="p-2 border-2 border-brutal-white bg-brutal-neon text-brutal-black hover:bg-brutal-white" title="Save">
              <Check size={16} />
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'One line per lyric…\n\nThen use the timer button to tap-sync each line to the beat.'}
          className="flex-1 w-full bg-brutal-black border-2 border-brutal-white/40 focus:border-brutal-neon p-3 font-mono text-sm text-brutal-white resize-none focus:outline-none custom-scrollbar"
        />
        <p className="font-mono text-[10px] text-brutal-white/40 uppercase">SAVING_REPLACES_ANY_EXISTING_SYNC</p>
      </div>
    );
  }

  // ─── SYNC (tap-along) ───────────────────────────────────────────────────────
  if (mode === 'sync') {
    const done = syncIdx >= syncLines.length;
    const line = (i: number) => (i >= 0 && i < syncLines.length ? syncLines[i] || '♪' : '');
    return (
      <div className="h-full flex flex-col p-4 select-none">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[11px] uppercase text-brutal-white/60">SYNC // {Math.min(syncIdx, syncLines.length)}/{syncLines.length}</span>
          <span className="font-mono text-xs text-brutal-neon tabular-nums">{formatTime(progress)}</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-2">
          <p className="font-mono text-sm text-brutal-white/25 truncate max-w-full">{line(syncIdx - 1)}</p>
          <p className="font-display text-2xl md:text-3xl uppercase text-brutal-neon leading-tight line-clamp-3">
            {done ? 'DONE — SAVE?' : line(syncIdx)}
          </p>
          <p className="font-mono text-sm text-brutal-white/25 truncate max-w-full">{line(syncIdx + 1)}</p>
        </div>

        <p className="font-mono text-[10px] text-brutal-white/40 uppercase text-center mb-3">
          PRESS_ENTER (OR TAP) ON_THE_BEAT
        </p>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => setMode('view')} className="brutal-btn text-xs flex items-center justify-center gap-1"><X size={14} /></button>
          <button onClick={undoStamp} disabled={syncIdx === 0} className="brutal-btn text-xs flex items-center justify-center gap-1 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button onClick={stampLine} disabled={done} className="brutal-btn text-xs bg-brutal-neon text-brutal-black border-brutal-black disabled:opacity-30">SET ↵</button>
          <button onClick={commitSync} disabled={syncIdx === 0} className="brutal-btn text-xs flex items-center justify-center gap-1 disabled:opacity-30"><Check size={14} /></button>
        </div>
      </div>
    );
  }

  // ─── VIEW: synced (real, or parsed from timestamped plain lyrics) ───────────
  if (displaySynced) {
    return (
      <div
        ref={containerRef}
        className={`h-full overflow-y-auto custom-scrollbar p-6 relative ${BG_CLASS[style.bg]}`}
      >
        {headerActions()}
        {trackHead()}
        {displaySynced.map((l, idx) => {
          const state = idx === activeIndex ? 'active' : idx < activeIndex ? 'passed' : 'upcoming';
          return (
            // A line is a seek target: click it and the song goes there. Rendered
            // as a real <button> so it's keyboard-reachable, but styled as the
            // bare line — the hover tint is the only affordance, since anything
            // heavier would clutter a page you mostly just read.
            <button
              key={idx}
              type="button"
              ref={state === 'active' ? activeLineRef : null}
              onClick={() => seek(l.timestamp)}
              title={`Jump to ${formatTime(l.timestamp)}`}
              className={`block w-full hover:bg-brutal-white/5 focus:outline-none focus-visible:bg-brutal-white/10 ${lineClass(style, state)}`}
              style={lineStyle(style, state)}
            >
              {l.text || '♪'}
            </button>
          );
        })}
        <div className="h-[50vh]" />
      </div>
    );
  }

  // ─── VIEW: plain ──────────────────────────────────────────────────────────────
  if (lyrics) {
    return (
      <div className={`h-full overflow-y-auto custom-scrollbar p-6 relative ${BG_CLASS[style.bg]}`}>
        {headerActions()}
        {trackHead()}
        {/* Untimed: no line is "active", so it renders at the passed-line size
            with full opacity rather than dimming the whole song. */}
        <div
          className={`${FONT_CLASS[style.font]} ${ALIGN_CLASS[style.align]} text-brutal-white leading-relaxed whitespace-pre-wrap`}
          style={{
            fontSize: Math.max(12, Math.round(style.size * 0.62)),
            textTransform: style.upper ? 'uppercase' : undefined,
          }}
        >
          {lyrics}
        </div>
      </div>
    );
  }

  // ─── VIEW: empty ──────────────────────────────────────────────────────────────
  // What the online lookup has to say about THIS track. Only reached when the
  // track has no lyrics, so a success never renders here — the found lyrics do.
  const fetchStatus = () => {
    switch (fetcher.status) {
      case 'loading':
        return (
          <p className="font-mono text-[10px] uppercase text-brutal-neon flex items-center gap-2 mb-4">
            <RefreshCw size={12} className="animate-spin" /> SEARCHING_LRCLIB…
          </p>
        );
      case 'not-found':
        return <p className="font-mono text-[10px] uppercase text-brutal-white/40 mb-4">NO_MATCH_ON_LRCLIB</p>;
      case 'instrumental':
        return <p className="font-mono text-[10px] uppercase text-brutal-white/40 mb-4">LRCLIB_SAYS_INSTRUMENTAL</p>;
      case 'offline':
        return (
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 flex items-center gap-2 mb-4">
            <WifiOff size={12} /> LOOKUP_UNAVAILABLE_HERE
          </p>
        );
      case 'error':
        return <p className="font-mono text-[10px] uppercase text-red-500 mb-4">LOOKUP_FAILED // {fetcher.error}</p>;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center text-brutal-white/30 p-4 text-center relative">
      {headerActions()}
      <FileText size={48} className="mb-4 opacity-50" />
      <span className="font-display text-xl tracking-tighter uppercase text-brutal-white/50">LYRICS_NOT_FOUND</span>
      <p className="font-mono text-xs mt-2 mb-5">NO SYLT OR USLT TAGS IN METADATA</p>

      {fetchStatus()}

      <div className="flex flex-wrap gap-2 justify-center">
        {/* Opt-in gate: the first press explains what leaves the machine, rather
            than silently making a network call the user never asked for. */}
        {!onlineLyrics ? (
          <button
            onClick={() => setOnlineLyrics(true)}
            title="Sends this track's title + artist to LRCLIB"
            className="brutal-btn text-xs flex items-center gap-2"
          >
            <Globe size={14} /> ENABLE_ONLINE_LYRICS
          </button>
        ) : (
          fetcher.canFetch && (
            <button
              onClick={fetcher.fetchNow}
              disabled={fetcher.status === 'loading'}
              className="brutal-btn text-xs flex items-center gap-2 disabled:opacity-40"
            >
              <DownloadCloud size={14} /> FETCH_SYNCED_LYRICS
            </button>
          )
        )}
        {updateTrackDetails && (
          <button onClick={() => { setDraft(''); setMode('paste'); }} className="brutal-btn text-xs flex items-center gap-2">
            <Pencil size={14} /> ADD_LYRICS
          </button>
        )}
      </div>

      {onlineLyrics && !fetcher.canFetch && (
        <p className="font-mono text-[10px] uppercase text-brutal-white/30 mt-4">
          NEED_A_TITLE_+_ARTIST_TAG_TO_SEARCH
        </p>
      )}
    </div>
  );
};
