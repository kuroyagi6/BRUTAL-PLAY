import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Zap, Disc } from 'lucide-react';
import type { Track } from '../types';
import { formatTime } from '../utils/format';
import { Visualizer, VisualizerMode } from './Visualizer';
import { resolveSyncedLyrics } from '../utils/lrc';
import { usePlayer } from '../player/PlayerContext';
import { useVisualizerFrames } from '../player/useVisualizerFrames';

// STAGE — the immersive "now playing" view that replaced the old Active Deck. A
// full-bleed visualizer backdrop, the album art + title/artist centered over it,
// a compact synced-lyrics strip, and floating transport at the bottom. It's a
// pure presentation of the playback state passed in; no engine logic lives here.
interface StageViewProps {
  visualizerMode: VisualizerMode;
  onCycleVisualizer: () => void;
}

// The 3-line synced-lyrics window: previous / current / next, tracking progress.
function LyricStrip({ track, progress }: { track: Track | null; progress: number }) {
  // Follow real syncedLyrics OR timestamps parsed out of plain lyrics.
  const lines = React.useMemo(() => resolveSyncedLyrics(track), [track?.syncedLyrics, track?.lyrics]);
  const activeIdx = React.useMemo(() => {
    if (!lines || lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (progress >= lines[i].timestamp) idx = i;
      else break;
    }
    return idx;
  }, [lines, progress]);

  if (lines && lines.length > 0) {
    const line = (i: number) => (i >= 0 && i < lines.length ? lines[i].text : '');
    return (
      <div className="flex flex-col items-center gap-1 text-center px-6 min-h-[84px] justify-center">
        <p className="font-mono text-[11px] uppercase text-brutal-white/30 truncate max-w-full">{line(activeIdx - 1)}</p>
        <p className="font-display text-lg uppercase text-brutal-neon leading-tight line-clamp-2 max-w-full">
          {activeIdx < 0 ? '♪' : line(activeIdx) || '♪'}
        </p>
        <p className="font-mono text-[11px] uppercase text-brutal-white/30 truncate max-w-full">{line(activeIdx + 1)}</p>
      </div>
    );
  }

  // Plain (unsynced) lyrics: show the opening lines, static.
  if (track?.lyrics) {
    return (
      <div className="max-w-md mx-auto px-6 min-h-[84px] overflow-hidden">
        <p className="font-mono text-[11px] uppercase text-brutal-white/40 text-center line-clamp-4 whitespace-pre-line leading-relaxed">
          {track.lyrics}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[84px] flex items-center justify-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-brutal-white/20">— NO LYRICS —</p>
    </div>
  );
}

export function StageView({ visualizerMode, onCycleVisualizer }: StageViewProps) {
  const {
    currentTrack, isPlaying, progress, duration, seek, togglePlay, playNext, playPrev,
    shuffle: isShuffle, toggleShuffle, repeatMode, toggleRepeat, volume, setVolume, isMuted, toggleMute,
    analyser,
  } = usePlayer();
  // A popped-out STAGE has no local AnalyserNode (the engine runs in another
  // process), so it draws the spectrum from the IPC frame stream instead. When
  // there IS a local analyser (the desktop window) this returns null and the
  // Visualizer uses the analyser exactly as before — no streaming, no change.
  const frames = useVisualizerFrames(!analyser);
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const hasTrack = !!currentTrack;

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const iconBtn = 'p-2 text-brutal-white enabled:hover:text-brutal-neon transition-colors disabled:opacity-30';

  return (
    <div className="relative h-full overflow-hidden bg-brutal-black">
      {/* Full-bleed visualizer backdrop — clicking it toggles play, like the old deck */}
      <div className="absolute inset-0 z-0 opacity-40">
        <Visualizer isPlaying={isPlaying} mode={visualizerMode} analyser={analyser} frames={frames} onTogglePlay={togglePlay} />
      </div>
      {/* Legibility scrim: darken top + bottom so overlaid text reads on any art/viz */}
      <div className="absolute inset-0 z-[1] pointer-events-none bg-gradient-to-b from-brutal-black/80 via-brutal-black/30 to-brutal-black/90" />

      {/* Cycle-visualizer button (kept from the old deck) */}
      <button
        onClick={onCycleVisualizer}
        className="absolute top-4 right-4 z-20 p-2 bg-brutal-black/70 border-2 border-brutal-white text-brutal-white hover:bg-brutal-neon hover:text-brutal-black transition-colors"
        title="CYCLE_VISUALIZER"
      >
        <Zap size={16} />
      </button>

      {/* Foreground content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-between py-6 px-4 pointer-events-none">
        {/* Art + title + lyrics are ONE centered group. They used to be two
            siblings of `justify-between`, which pushed the lyrics down to meet
            the controls and left a hole between the artist name and the words —
            worse the wider/shorter the window got, because justify-between
            spends all the slack on the gaps. As one group they stay together at
            any window size and the free space sits outside them. */}
        <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-4 overflow-hidden">
          <div className="w-40 h-40 md:w-52 md:h-52 border-4 border-brutal-white bg-brutal-black shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] overflow-hidden flex items-center justify-center shrink-0">
            {currentTrack?.coverUrl ? (
              <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <Disc size={64} className={`text-brutal-white/20 ${isPlaying ? 'animate-spin-slow' : ''}`} />
            )}
          </div>
          <div className="text-center max-w-full px-4">
            <p className="font-display text-2xl md:text-3xl uppercase leading-none truncate max-w-full" title={currentTrack?.name}>
              {currentTrack?.name || 'NO_SIGNAL'}
            </p>
            <p className="font-mono text-xs uppercase text-brutal-white/50 mt-2 truncate">{currentTrack?.artist || '—'}</p>
          </div>

          {/* Lyrics strip */}
          <LyricStrip track={currentTrack} progress={progress} />
        </div>

        {/* Controls (re-enable pointer events for this block) */}
        <div className="w-full max-w-xl pointer-events-auto">
          {/* Seek */}
          <div className="flex items-center gap-3 font-mono text-[10px] text-brutal-white/60 tabular-nums mb-3">
            <span>{formatTime(progress)}</span>
            <div className={`flex-1 h-2 bg-brutal-white/15 relative ${hasTrack ? 'cursor-pointer' : ''}`} onClick={hasTrack ? onSeek : undefined}>
              <div className="h-full bg-brutal-neon" style={{ width: `${pct}%` }} />
            </div>
            <span>{duration > 0 ? formatTime(duration) : '-:--'}</span>
          </div>

          {/* Transport */}
          <div className="flex items-center justify-center gap-2">
            <button onClick={toggleShuffle} className={`p-2 transition-colors ${isShuffle ? 'text-brutal-neon' : 'text-brutal-white/60 hover:text-brutal-white'}`} title="SHUFFLE">
              <Shuffle size={18} />
            </button>
            <button onClick={playPrev} disabled={!hasTrack} className={iconBtn} title="PREVIOUS">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button
              onClick={togglePlay}
              disabled={!hasTrack}
              className="p-3 mx-1 bg-brutal-neon text-brutal-black border-2 border-brutal-white hover:bg-brutal-white transition-colors disabled:opacity-30"
              title="PLAY / PAUSE"
            >
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button onClick={playNext} disabled={!hasTrack} className={iconBtn} title="NEXT">
              <SkipForward size={22} fill="currentColor" />
            </button>
            <button onClick={toggleRepeat} className={`p-2 transition-colors ${repeatMode !== 'none' ? 'text-brutal-neon' : 'text-brutal-white/60 hover:text-brutal-white'}`} title={`REPEAT_${repeatMode.toUpperCase()}`}>
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 mt-3 max-w-xs mx-auto">
            <button onClick={toggleMute} className="text-brutal-white/60 hover:text-brutal-neon transition-colors" title="MUTE">
              {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="flex-1 h-2 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
