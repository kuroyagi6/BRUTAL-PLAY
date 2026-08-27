// The MEANING panel: what the line playing right now is about, from Genius'
// crowd-sourced annotations. The right-hand column of the LYRICS window (and
// the whole body of it when the window is too narrow to split).
//
// It reads the same active-line index the lyrics view scrolls to (utils/lrc
// #activeLineIndex), so the explanation can never drift a line behind what's
// highlighted. When the current line has no annotation it holds the last one
// that did — annotations cover maybe a third of a song, and blanking out every
// few seconds is worse than showing the passage you're still inside.
import React from 'react';
import {
  BookOpen, ExternalLink, HardDrive, KeyRound, RefreshCw, WifiOff,
} from 'lucide-react';
import type { Track } from '../types';
import { resolveSyncedLyrics, activeLineIndex } from '../utils/lrc';
import { useGeniusMeaning, useGeniusMeanings, useGeniusToken } from '../hooks/useGenius';
import type { Annotation } from '../services/geniusMeaning';

interface MeaningCornerProps {
  currentTrack: Track | null;
  progress: number;
  /** Opens the Settings window on the token field. */
  onOpenSettings?: () => void;
}

export const MeaningCorner: React.FC<MeaningCornerProps> = ({
  currentTrack,
  progress,
  onOpenSettings,
}) => {
  const [enabled, setEnabled] = useGeniusMeaning();
  const [token] = useGeniusToken();

  // The lines the view is showing, in the same order — synced when we have it,
  // plain text otherwise (no active line to follow, but the song's annotations
  // are still worth reading).
  const synced = resolveSyncedLyrics(currentTrack);
  const lines = React.useMemo(() => {
    if (synced) return synced.map((l) => l.text);
    return currentTrack?.lyrics ? currentTrack.lyrics.split('\n') : [];
  }, [synced, currentTrack?.lyrics]);

  const activeIdx = synced ? activeLineIndex(synced, progress) : -1;

  // Auto-load: once the feature is on and a token is set, every song fetches
  // itself. Tying this to the panel being expanded meant a per-song click, and
  // a lookup that only happens when you're looking at it is the wrong shape for
  // something you read WHILE the song plays. Cached songs cost nothing anyway.
  const meanings = useGeniusMeanings(currentTrack, lines, enabled, true);

  // The annotation for the current line, or the most recent one before it.
  const { shown, shownIdx } = React.useMemo(() => {
    const byLine = meanings.byLine;
    if (!byLine.length) return { shown: null as Annotation | null, shownIdx: -1 };
    const from = activeIdx >= 0 ? Math.min(activeIdx, byLine.length - 1) : -1;
    if (from < 0) {
      // Untimed lyrics: show the song's first annotation as an entry point.
      const first = byLine.findIndex((a: Annotation | null) => !!a);
      return { shown: first >= 0 ? byLine[first] : null, shownIdx: first };
    }
    for (let i = from; i >= 0; i--) {
      if (byLine[i]) return { shown: byLine[i], shownIdx: i };
    }
    return { shown: null as Annotation | null, shownIdx: -1 };
  }, [meanings.byLine, activeIdx]);

  const isStale = shownIdx >= 0 && activeIdx >= 0 && shownIdx !== activeIdx;

  const header = (
    <div className="w-full flex items-center justify-between px-3 py-2 bg-brutal-black border-b-2 border-brutal-white/20 shrink-0">
      <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-tighter text-brutal-white">
        <BookOpen size={13} className="text-brutal-neon" />
        MEANING
        {enabled && meanings.total > 0 && (
          <span className="opacity-40">// {meanings.matched}/{meanings.total}_LINES</span>
        )}
      </span>
      {meanings.status === 'loading' && <RefreshCw size={12} className="animate-spin text-brutal-neon" />}
    </div>
  );

  const body = () => {
    // Opt-in gate first: nothing has been sent anywhere yet.
    if (!enabled) {
      return (
        <div className="p-4 text-center">
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 mb-3">
            EXPLAINS_THE_PLAYING_LINE_USING_GENIUS_ANNOTATIONS.
            <br />
            SENDS_TITLE_+_ARTIST_TO_GENIUS. NEEDS_YOUR_OWN_FREE_TOKEN.
            <br />
            EACH_SONG_IS_FETCHED_ONCE_THEN_KEPT_FOR_OFFLINE_USE.
          </p>
          <button onClick={() => setEnabled(true)} className="brutal-btn text-xs flex items-center gap-2 mx-auto">
            <BookOpen size={14} /> ENABLE_MEANINGS
          </button>
        </div>
      );
    }

    if (!token || meanings.status === 'no-token') {
      return (
        <div className="p-4 text-center">
          <KeyRound size={20} className="mx-auto mb-2 text-brutal-white/40" />
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 mb-1">
            {meanings.status === 'no-token' && token ? 'TOKEN_REJECTED_BY_GENIUS' : 'NO_GENIUS_TOKEN_SET'}
          </p>
          <p className="font-mono text-[10px] uppercase text-brutal-white/30 mb-3">
            GENIUS.COM/API-CLIENTS → GENERATE_CLIENT_ACCESS_TOKEN → PASTE_IN_SETTINGS
          </p>
          {onOpenSettings && (
            <button onClick={onOpenSettings} className="brutal-btn text-xs">OPEN_SETTINGS</button>
          )}
        </div>
      );
    }

    if (!currentTrack) {
      return <p className="p-4 text-center font-mono text-[10px] uppercase text-brutal-white/30">NO_ACTIVE_TRACK</p>;
    }

    if (!meanings.canFetch) {
      return (
        <p className="p-4 text-center font-mono text-[10px] uppercase text-brutal-white/30">
          NEED_A_TITLE_+_ARTIST_TAG_TO_SEARCH
        </p>
      );
    }

    if (meanings.status === 'offline') {
      return (
        <div className="p-4 text-center">
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 flex items-center justify-center gap-2 mb-1">
            <WifiOff size={12} /> NOT_CACHED_AND_NO_LOOKUP_AVAILABLE
          </p>
          <p className="font-mono text-[10px] uppercase text-brutal-white/25">
            SONGS_LOOKED_UP_ONCE_STAY_READABLE_OFFLINE.
          </p>
        </div>
      );
    }

    if (meanings.status === 'error') {
      return (
        <div className="p-4 text-center">
          <p className="font-mono text-[10px] uppercase text-red-500 mb-3">LOOKUP_FAILED // {meanings.error}</p>
          <button onClick={meanings.fetchNow} className="brutal-btn text-xs">RETRY</button>
        </div>
      );
    }

    if (meanings.status === 'idle' || meanings.status === 'loading') {
      return (
        <div className="p-4 text-center">
          <button
            onClick={meanings.fetchNow}
            disabled={meanings.status === 'loading'}
            className="brutal-btn text-xs flex items-center gap-2 mx-auto disabled:opacity-40"
          >
            {meanings.status === 'loading'
              ? <><RefreshCw size={14} className="animate-spin" /> READING_GENIUS…</>
              : <><BookOpen size={14} /> LOAD_MEANINGS</>}
          </button>
        </div>
      );
    }

    if (meanings.status === 'not-found') {
      return (
        <div className="p-4 text-center">
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 mb-3">
            NO_ANNOTATIONS_ON_GENIUS_FOR_THIS_TRACK
          </p>
          <button onClick={meanings.fetchNow} className="brutal-btn text-xs">RETRY</button>
        </div>
      );
    }

    // status === 'ready'
    if (!shown) {
      return (
        <div className="p-4 text-center">
          <p className="font-mono text-[10px] uppercase text-brutal-white/30">
            {meanings.matched === 0
              ? 'ANNOTATIONS_FOUND_BUT_NONE_MATCHED_THESE_LINES'
              : 'NOTHING_ANNOTATED_YET_AT_THIS_POINT'}
          </p>
          {meanings.song && (
            <p className="font-mono text-[9px] uppercase text-brutal-white/20 mt-2">
              GENIUS // {meanings.song.artist} — {meanings.song.title}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display uppercase tracking-tighter text-brutal-neon text-sm leading-tight">
            “{shown.fragment.split('\n').join(' / ')}”
          </p>
          {shown.url && (
            <a
              href={shown.url}
              target="_blank"
              rel="noreferrer noopener"
              title="Read on Genius"
              className="shrink-0 p-1 border-2 border-brutal-white/40 text-brutal-white/60 hover:border-brutal-neon hover:text-brutal-neon transition-colors"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        {isStale && (
          <p className="font-mono text-[9px] uppercase text-brutal-white/30">
            ↑ STILL_SHOWING_THE_LAST_ANNOTATED_LINE
          </p>
        )}
        <p className="font-mono text-[11px] leading-relaxed text-brutal-white/80 whitespace-pre-wrap">
          {shown.body}
        </p>
        {/* This song was looked up in an earlier session and read back off disk
            — no connection was needed to show it. */}
        {meanings.fromCache && meanings.cachedAt && (
          <p className="font-mono text-[9px] uppercase text-brutal-white/25 flex items-center gap-1 pt-1">
            <HardDrive size={10} /> OFFLINE_COPY // SAVED_{new Date(meanings.cachedAt)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, '_')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">{body()}</div>
    </div>
  );
};
