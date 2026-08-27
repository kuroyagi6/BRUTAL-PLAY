import React from 'react';
import { Youtube, ListVideo, ExternalLink } from 'lucide-react';
import type { YouTubeItem } from '../types';
import { youTubeEmbedUrl, youTubeWatchUrl } from '../utils/youtube';

// The single YouTube player window. Plays through YouTube's OWN embedded player
// via a plain <iframe> (the reliable path — verified to render) with
// `enablejsapi=1`, and talks to it over postMessage to learn when playback ENDS
// so a wired item can hand off onward. There is no stream URL and no <audio>/
// <video> element; the audio lives inside a cross-origin iframe, unreachable by
// the Web Audio graph (no EQ/visualizer/crossfade — a hard browser boundary).
//
// End detection: YouTube pushes `infoDelivery` messages carrying `playerState`
// (0 = ended, 1 = playing) on every state change. `item.kind` picks the strategy:
//   • video    — a single ENDED is unambiguous; hand off immediately.
//   • playlist — ENDED also fires BETWEEN clips (immediately followed by a 1 for
//     the next clip), so we DEBOUNCE: an ENDED only counts as the whole-playlist
//     end if no PLAYING arrives within END_GRACE_MS.
// This needs only postMessage, not the full IFrame API (which rendered black in
// testing), so the reliable plain-iframe playback is preserved.
//
// Couplings: `onPlay` pauses the music engine (fired on load — the embed
// autoplays); `onEnded` follows the wire. Embedding-disabled uploads show
// YouTube's own error in the frame, so a real "open on YouTube" link is always up.

interface YouTubePlayerWindowProps {
  item: YouTubeItem | null;
  onPlay: () => void;
  onEnded: () => void;
}

// How long to wait after an ENDED before believing the whole item is done. A
// playlist's next clip starts well within this window and cancels the handoff.
const END_GRACE_MS = 1500;

export const YouTubePlayerWindow: React.FC<YouTubePlayerWindowProps> = ({ item, onPlay, onEnded }) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const onPlayRef = React.useRef(onPlay);
  onPlayRef.current = onPlay;
  const onEndedRef = React.useRef(onEnded);
  onEndedRef.current = onEnded;

  React.useEffect(() => {
    if (!item) return;
    // Loading an item is the user's intent to play — pause the music now.
    onPlayRef.current();

    const iframe = iframeRef.current;
    if (!iframe) return;

    let endTimer: number | null = null;
    const clearEnd = () => {
      if (endTimer !== null) {
        clearTimeout(endTimer);
        endTimer = null;
      }
    };

    const onMessage = (e: MessageEvent) => {
      // Only trust messages from a youtube.com frame.
      let host = '';
      try {
        host = new URL(e.origin).hostname;
      } catch {
        return;
      }
      if (!/(^|\.)youtube\.com$/.test(host)) return;
      if (typeof e.data !== 'string') return;

      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      const state =
        msg?.info?.playerState ?? (msg?.event === 'onStateChange' ? msg?.info : undefined);
      if (typeof state !== 'number') return;

      if (state === 1) {
        // Playing (or a playlist's next clip started) — cancel any pending end.
        clearEnd();
      } else if (state === 0) {
        clearEnd();
        if (item.kind === 'playlist') {
          // Might be a between-clips ENDED; a next-clip PLAYING cancels this.
          endTimer = window.setTimeout(() => onEndedRef.current(), END_GRACE_MS);
        } else {
          // Single video: the end is the end. Hand off now (before any auto-replay).
          onEndedRef.current();
        }
      }
    };
    window.addEventListener('message', onMessage);

    // Register with the player so it starts sending infoDelivery updates.
    const register = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: item.id, channel: 'widget' }),
        '*'
      );
    };
    iframe.addEventListener('load', register);
    // In case the iframe already loaded before this listener attached.
    const kick = window.setTimeout(register, 800);

    return () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', register);
      clearTimeout(kick);
      clearEnd();
    };
  }, [item?.id]);

  if (!item) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-brutal-black text-brutal-white/30">
        <Youtube size={44} />
        <p className="font-mono text-[10px] uppercase tracking-widest">NO_YOUTUBE_SELECTED</p>
        <p className="font-mono text-[9px] uppercase tracking-widest opacity-60">
          DOUBLE-CLICK A YOUTUBE ICON
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-brutal-black text-brutal-white">
      {/* Stage — the embedded YouTube player fills the frame (16:9 letterboxed). */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        <iframe
          key={item.id}
          ref={iframeRef}
          title={item.name}
          src={youTubeEmbedUrl(item)}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      {/* Title bar with the kind badge and the always-there YouTube fallback link. */}
      <div className="shrink-0 border-t-4 border-brutal-white bg-brutal-black p-2 flex items-center gap-2">
        {item.kind === 'playlist' ? (
          <ListVideo size={12} className="shrink-0 text-brutal-neon" />
        ) : (
          <Youtube size={12} className="shrink-0 text-brutal-neon" />
        )}
        <span className="flex-1 min-w-0 font-mono text-[10px] uppercase truncate">{item.name}</span>
        <span className="shrink-0 font-mono text-[8px] uppercase px-1 border border-brutal-white/40 text-brutal-white/60">
          {item.kind === 'playlist' ? 'LIST' : 'VID'}
        </span>
        <a
          href={youTubeWatchUrl(item)}
          target="_blank"
          rel="noreferrer"
          title="OPEN_ON_YOUTUBE (if embedding is blocked)"
          className="shrink-0 flex items-center gap-1 px-2 py-1 border-2 border-brutal-white/40 hover:bg-brutal-neon hover:text-brutal-black hover:border-brutal-black transition-colors font-mono text-[8px] uppercase"
        >
          <ExternalLink size={11} strokeWidth={3} /> YOUTUBE
        </a>
      </div>
    </div>
  );
};
