// SEARCH_BY_LYRICS results. Find the song from a line you remember: runs
// entirely over the lyrics already stored on your tracks (services/lyricsSearch)
// — no network, no index to build, nothing sent anywhere. Clicking a hit plays
// that track and, when the lyrics are synced, jumps straight to that line.
//
// The query box lives in the LYRICS window toolbar, so this is results-only and
// controlled: it renders over the lyrics while there's something to search for.
import React from 'react';
import { Play, Quote } from 'lucide-react';
import { usePlayer } from '../player/PlayerContext';
import { searchLyrics, countIndexedTracks, type LyricHit } from '../services/lyricsSearch';
import { formatTime } from '../utils/format';

/** Split a hit's text around the match so the phrase can be highlighted. */
function highlight(hit: LyricHit) {
  if (hit.matchStart < 0) return { pre: '', mid: hit.text, post: '' };
  return {
    pre: hit.text.slice(0, hit.matchStart),
    mid: hit.text.slice(hit.matchStart, hit.matchEnd),
    post: hit.text.slice(hit.matchEnd),
  };
}

interface LyricsSearchViewProps {
  /** Owned by the toolbar box above. */
  query: string;
  /** Called after a hit is opened, so the results can get out of the way. */
  onOpened?: () => void;
}

export const LyricsSearchView: React.FC<LyricsSearchViewProps> = ({ query, onOpened }) => {
  const { playlist, playTrack, seek, currentTrack, duration } = usePlayer();

  // Searching every line of every track on each keystroke is fine at library
  // scale (it's a substring scan over text already in memory) and keeps the
  // results honest as you type — no debounce, matching the Spotlight index.
  const hits = React.useMemo(() => searchLyrics(playlist, query), [playlist, query]);
  const indexed = React.useMemo(() => countIndexedTracks(playlist), [playlist]);

  // A seek can only land once the new track is actually loaded, so the jump is
  // parked here and applied when `duration` for that track arrives.
  const pending = React.useRef<{ id: string; time: number } | null>(null);
  React.useEffect(() => {
    const p = pending.current;
    if (p && currentTrack?.id === p.id && duration > 0) {
      seek(p.time);
      pending.current = null;
    }
  }, [currentTrack?.id, duration, seek]);

  const open = (hit: LyricHit) => {
    const index = playlist.findIndex((t: { id: string }) => t.id === hit.trackId);
    if (index < 0) return;

    if (currentTrack?.id === hit.trackId) {
      // Already playing it — nothing to load, so jump now.
      if (hit.timestamp !== undefined) seek(hit.timestamp);
      onOpened?.();
      return;
    }
    pending.current = hit.timestamp !== undefined ? { id: hit.trackId, time: hit.timestamp } : null;
    // The whole library becomes the queue, so next/prev work after the jump.
    playTrack(index, playlist.map((t: { id: string }) => t.id));
    onOpened?.();
  };

  return (
    <div className="h-full flex flex-col bg-brutal-black">
      <p className="font-mono text-[10px] uppercase text-brutal-white/30 px-3 py-2 border-b-2 border-brutal-white/20 shrink-0">
        {query.trim().length >= 2
          ? `${hits.length}${hits.length === 200 ? '+' : ''}_HITS // ${indexed}_TRACKS_INDEXED`
          : `${indexed}_OF_${playlist.length}_TRACKS_HAVE_LYRICS`}
      </p>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {query.trim().length < 2 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-brutal-white/30">
            <Quote size={40} className="mb-4 opacity-40" />
            <p className="font-display text-lg uppercase tracking-tighter text-brutal-white/50">
              SEARCH_YOUR_LYRICS
            </p>
            <p className="font-mono text-[10px] uppercase mt-2 max-w-[36ch] leading-relaxed">
              TYPE_A_PHRASE_TO_FIND_THE_TRACK_IT_BELONGS_TO.
              {indexed < playlist.length &&
                ' TRACKS_WITHOUT_SAVED_LYRICS_ARE_INVISIBLE_HERE — FETCH_THEM_ON_THE_NOW_TAB_OR_TURN_ON_AUTO_FETCH_LYRICS.'}
            </p>
          </div>
        ) : hits.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-brutal-white/30">
            <p className="font-display text-lg uppercase tracking-tighter text-brutal-white/50">NO_MATCH</p>
            <p className="font-mono text-[10px] uppercase mt-2 max-w-[36ch] leading-relaxed">
              NOT_IN_THE_{indexed}_TRACKS_THAT_HAVE_LYRICS_SAVED.
            </p>
          </div>
        ) : (
          hits.map((hit: LyricHit) => {
            const { pre, mid, post } = highlight(hit);
            const isCurrent = currentTrack?.id === hit.trackId;
            return (
              <button
                key={`${hit.trackId}:${hit.lineIndex}`}
                onClick={() => open(hit)}
                className={`w-full text-left px-3 py-3 border-b-2 border-brutal-white/10 hover:bg-brutal-white/5 transition-colors group ${
                  isCurrent ? 'bg-brutal-neon/5' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-display text-sm uppercase tracking-tighter text-brutal-white truncate">
                    {hit.trackName}
                  </span>
                  <span className="font-mono text-[10px] text-brutal-neon tabular-nums shrink-0 flex items-center gap-1">
                    {hit.timestamp !== undefined ? formatTime(hit.timestamp) : 'NO_SYNC'}
                    <Play size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </div>
                <p className="font-mono text-[10px] uppercase text-brutal-white/40 truncate mb-1">{hit.artist}</p>
                {hit.before && (
                  <p className="font-mono text-[10px] text-brutal-white/25 truncate">{hit.before}</p>
                )}
                <p className="font-mono text-xs text-brutal-white truncate">
                  {pre}
                  <mark className="bg-brutal-neon text-brutal-black">{mid}</mark>
                  {post}
                </p>
                {hit.after && (
                  <p className="font-mono text-[10px] text-brutal-white/25 truncate">{hit.after}</p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
