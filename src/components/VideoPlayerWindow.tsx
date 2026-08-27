import React from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Film, SkipBack, SkipForward } from 'lucide-react';
import type { VideoItem } from '../types';
import { formatTime } from '../utils/format';

// The video player window. Owns a single <video> element that STREAMS the file
// from disk over local-media:// (which serves Range requests, so scrubbing works
// without loading gigabytes into memory). It is completely independent of the
// audio engine: no shared element, no shared graph. When playback starts it
// calls `onPlay` so App can pause the music — the one and only coupling point,
// and it lives at the App composition seam, not inside either engine.

interface VideoPlayerWindowProps {
  video: VideoItem | null;
  /** Fired when this player starts playing, so App can pause the music engine. */
  onPlay: () => void;
  /** Report metadata learned from the element back to the library (persisted). */
  onMeta: (id: string, meta: { duration?: number; width?: number; height?: number }) => void;
  /** Report play/pause up so the folder window can show the live indicator. */
  onPlayingChange: (playing: boolean) => void;
  /** Fired when the clip reaches its end, so App can advance the video folder /
   *  follow a wire onward. Distinct from a pause. */
  onEnded?: () => void;
}

export const VideoPlayerWindow: React.FC<VideoPlayerWindowProps> = ({
  video,
  onPlay,
  onMeta,
  onPlayingChange,
  onEnded,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);

  // Latest onPlay/onMeta without re-subscribing the element's listeners.
  const onPlayRef = React.useRef(onPlay);
  onPlayRef.current = onPlay;
  const onMetaRef = React.useRef(onMeta);
  onMetaRef.current = onMeta;
  const onPlayingChangeRef = React.useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const onEndedRef = React.useRef(onEnded);
  onEndedRef.current = onEnded;

  // When the selected video changes, reset transport state and autoplay it.
  React.useEffect(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    setProgress(0);
    setDuration(0);
    // Attempting play may reject (autoplay policy); the play/pause events keep
    // our state honest either way.
    el.play().catch(() => { /* user can press play */ });
  }, [video?.id]);

  React.useEffect(() => {
    const el = videoRef.current;
    if (el) el.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const onLoadedMeta = () => {
    const el = videoRef.current;
    if (!el || !video) return;
    setDuration(el.duration || 0);
    onMetaRef.current(video.id, {
      duration: isFinite(el.duration) ? el.duration : undefined,
      width: el.videoWidth || undefined,
      height: el.videoHeight || undefined,
    });
  };

  const handlePlay = () => {
    setIsPlaying(true);
    onPlayingChangeRef.current(true);
    onPlayRef.current(); // pause the music engine
  };
  const handlePause = () => {
    setIsPlaying(false);
    onPlayingChangeRef.current(false);
  };
  const handleEnded = () => {
    handlePause();
    onEndedRef.current?.();
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const seekTo = (t: number) => {
    const el = videoRef.current;
    if (el) el.currentTime = t;
    setProgress(t);
  };
  const nudge = (delta: number) => {
    const el = videoRef.current;
    if (el) seekTo(Math.min(duration || el.duration || 0, Math.max(0, el.currentTime + delta)));
  };

  const toggleFullscreen = () => {
    const box = containerRef.current;
    if (!box) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.requestFullscreen().catch(() => {});
  };

  if (!video) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-brutal-black text-brutal-white/30">
        <Film size={44} />
        <p className="font-mono text-[10px] uppercase tracking-widest">NO_VIDEO_SELECTED</p>
        <p className="font-mono text-[9px] uppercase tracking-widest opacity-60">
          OPEN A VIDEO FOLDER · DOUBLE-CLICK A CLIP
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-brutal-black text-brutal-white">
      {/* ─── Stage ──────────────────────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        <video
          key={video.id}
          ref={videoRef}
          src={video.url}
          className="max-w-full max-h-full"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={onLoadedMeta}
          onTimeUpdate={() => setProgress(videoRef.current?.currentTime || 0)}
          onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          playsInline
        />
      </div>

      {/* ─── Transport ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t-4 border-brutal-white bg-brutal-black p-2 space-y-2">
        {/* Title */}
        <div className="flex items-center gap-2 px-1">
          <Film size={12} className="shrink-0 text-brutal-neon" />
          <span className="flex-1 min-w-0 font-mono text-[10px] uppercase truncate">{video.name}</span>
        </div>

        {/* Scrubber */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] tabular-nums opacity-60 w-10 text-right">{formatTime(progress)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(progress, duration || 0)}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            className="flex-1 accent-brutal-neon cursor-pointer"
          />
          <span className="font-mono text-[9px] tabular-nums opacity-60 w-10">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => nudge(-10)}
            title="BACK_10S"
            className="p-1.5 border-2 border-brutal-white/40 hover:bg-brutal-neon hover:text-brutal-black hover:border-brutal-black transition-colors"
          >
            <SkipBack size={14} strokeWidth={3} />
          </button>
          <button
            onClick={togglePlay}
            title={isPlaying ? 'PAUSE' : 'PLAY'}
            className="p-2 border-2 border-brutal-white bg-brutal-neon text-brutal-black hover:bg-brutal-white transition-colors"
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button
            onClick={() => nudge(10)}
            title="FWD_10S"
            className="p-1.5 border-2 border-brutal-white/40 hover:bg-brutal-neon hover:text-brutal-black hover:border-brutal-black transition-colors"
          >
            <SkipForward size={14} strokeWidth={3} />
          </button>

          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'UNMUTE' : 'MUTE'}
              className="p-1.5 border-2 border-brutal-white/40 hover:bg-brutal-neon hover:text-brutal-black hover:border-brutal-black transition-colors"
            >
              {muted || volume === 0 ? <VolumeX size={14} strokeWidth={3} /> : <Volume2 size={14} strokeWidth={3} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                setMuted(false);
              }}
              className="w-20 accent-brutal-neon cursor-pointer"
              title="VOLUME"
            />
          </div>

          <button
            onClick={toggleFullscreen}
            title="FULLSCREEN"
            className="ml-auto p-1.5 border-2 border-brutal-white/40 hover:bg-brutal-neon hover:text-brutal-black hover:border-brutal-black transition-colors"
          >
            <Maximize size={14} strokeWidth={3} />
          </button>
        </div>
      </div>
    </div>
  );
};
