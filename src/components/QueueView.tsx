import React from 'react';
import { motion } from 'motion/react';
import { ListOrdered, Play } from 'lucide-react';
import type { Track } from '../types';
import { resolveQueue } from '../audio/queue';
import { formatTime } from '../utils/format';
import { usePlayer } from '../player/PlayerContext';

export function QueueView() {
  const { queue, playlist, currentTrack, isPlaying, playTrack } = usePlayer();
  // The effective play order: the active queue filtered to existing tracks,
  // falling back to the full library order before anything is played.
  const orderedIds = resolveQueue(playlist.map((t) => t.id), queue);
  const byId = React.useMemo(() => new Map(playlist.map((t) => [t.id, t])), [playlist]);
  const tracks = orderedIds.map((id) => byId.get(id)).filter((t): t is Track => !!t);

  const currentPos = currentTrack ? orderedIds.indexOf(currentTrack.id) : -1;
  const upNextCount = currentPos >= 0 ? tracks.length - currentPos - 1 : tracks.length;

  const jumpTo = (trackId: string) => {
    const masterIndex = playlist.findIndex((t) => t.id === trackId);
    if (masterIndex >= 0) playTrack(masterIndex, orderedIds);
  };

  if (tracks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 border-4 border-dashed border-brutal-white/20 flex items-center justify-center mb-4">
          <ListOrdered className="text-brutal-white/20" size={32} />
        </div>
        <p className="font-display text-xl uppercase tracking-tighter">QUEUE_EMPTY</p>
        <p className="font-mono text-[10px] text-brutal-white/40 uppercase mt-2">Play a track to build the queue</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <ListOrdered size={20} className="text-brutal-neon" />
          <h3 className="text-2xl font-display uppercase text-brutal-white leading-none">UP_NEXT</h3>
        </div>
        <div className="text-right font-mono text-[10px] uppercase">
          <p className="text-brutal-white/40">
            {currentPos >= 0 ? `${currentPos + 1} / ${tracks.length}` : `${tracks.length} TRACKS`}
          </p>
          <p className="text-brutal-neon">{upNextCount} UP NEXT</p>
        </div>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-1">
        {tracks.map((track, i) => {
          const isCurrent = currentTrack?.id === track.id;
          const isPlayed = currentPos >= 0 && i < currentPos;
          return (
            <motion.div
              key={track.id}
              whileHover={{ x: 4 }}
              onClick={() => jumpTo(track.id)}
              className={`p-2 cursor-pointer border-2 flex items-center gap-3 transition-colors ${
                isCurrent
                  ? 'border-brutal-neon bg-brutal-neon/10 text-brutal-neon'
                  : isPlayed
                  ? 'border-brutal-white/10 text-brutal-white/40 hover:border-brutal-white/40'
                  : 'border-brutal-white/20 text-brutal-white hover:border-brutal-neon'
              }`}
            >
              {/* index / now-playing indicator */}
              <div className="w-6 shrink-0 flex items-center justify-center font-mono text-xs">
                {isCurrent ? (
                  isPlaying ? (
                    <div className="flex items-end gap-[2px] h-4">
                      <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-1 bg-current" />
                      <motion.div animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 0.4 }} className="w-1 bg-current" />
                      <motion.div animate={{ height: [4, 10, 4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1 bg-current" />
                    </div>
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )
                ) : (
                  (i + 1).toString().padStart(2, '0')
                )}
              </div>

              {/* title / artist */}
              <div className="flex-1 min-w-0">
                <p className="font-bold uppercase truncate text-sm leading-tight">{track.name}</p>
                <p className="font-mono text-[10px] uppercase opacity-60 truncate">{track.artist}</p>
              </div>

              {/* duration */}
              <span className="font-mono text-[10px] opacity-50 shrink-0">{formatTime(track.duration || 0)}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
