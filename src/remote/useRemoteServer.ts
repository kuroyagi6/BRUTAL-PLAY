import React from 'react';
import type { Track, VideoItem } from '../types';
import {
  buildRemoteState,
  buildRemoteLibrary,
  buildRemoteVideoLibrary,
  applyRemoteCommand,
  parseRemoteCommand,
  type RemoteTransport,
} from './remoteProtocol';

// Self-contained bridge between the audio engine and the main-process LAN remote
// server (electron/remoteServer.cjs). Composed at App level exactly like
// useFolderWatch: it never touches useAudioPlayer's internals — it only READS the
// player's state to push to phones and CALLS the player's public transport when a
// phone sends a command. When `enabled` is false it tears the server down.

export interface RemoteStatus {
  running: boolean;
  ip: string | null;
  port: number | null;
  url: string | null;
  /** 4-digit access PIN for the phone. */
  pin?: string;
  /** QR (data: URL) encoding url + ?pin= for one-scan access. */
  qr?: string | null;
  error?: string;
}

/** A phone that has authenticated with the PIN. */
export interface RemoteDevice {
  id: string;
  name: string;
  ip: string;
  firstSeen: number;
  lastSeen: number;
  /** Trusted devices may control the PC; untrusted are view-only. */
  trusted: boolean;
  /** Has a live connection (open event stream) right now. */
  connected: boolean;
}

interface RemoteBridge {
  remoteStart?: () => Promise<RemoteStatus>;
  remoteStop?: () => Promise<RemoteStatus>;
  remoteSetLibrary?: (entries: unknown[]) => void;
  remoteSetVideos?: (entries: unknown[]) => void;
  remotePushState?: (state: unknown) => void;
  onRemoteCommand?: (cb: (cmd: unknown) => void) => () => void;
  remoteDevices?: () => Promise<RemoteDevice[]>;
}

export interface RemotePlayer extends RemoteTransport {
  playlist: Track[];
  currentTrack: Track | null;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isShuffle: boolean;
  repeatMode: 'none' | 'one' | 'all';
}

export interface UseRemoteServerArgs {
  enabled: boolean;
  player: RemotePlayer;
  /** Video library streamed to the phone's VIDEO tab (parallel to the audio one). */
  videos?: VideoItem[];
  /** Receives the live server status (or null when off / unavailable). */
  onStatus?: (status: RemoteStatus | null) => void;
  /** Receives the connected-device list, polled while enabled. */
  onDevices?: (devices: RemoteDevice[]) => void;
}

// Stable identity so a caller that omits `videos` doesn't retrigger the sync
// effect every render.
const EMPTY_VIDEOS: VideoItem[] = [];

const bridge = (): RemoteBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electronAPI : undefined) as RemoteBridge | undefined;

export function useRemoteServer({ enabled, player, videos, onStatus, onDevices }: UseRemoteServerArgs): void {
  const { playlist } = player;
  const videoList = videos ?? EMPTY_VIDEOS;

  // Freshest transport + playlist for the mount-once command subscription and the
  // start effect, without making them dependencies (which would re-subscribe /
  // restart the server on every render).
  const transportRef = React.useRef<RemoteTransport>(player);
  const playlistRef = React.useRef<Track[]>(playlist);
  const videosRef = React.useRef<VideoItem[]>(videoList);
  const onStatusRef = React.useRef(onStatus);
  const onDevicesRef = React.useRef(onDevices);
  React.useEffect(() => {
    transportRef.current = player;
    playlistRef.current = playlist;
    videosRef.current = videoList;
    onStatusRef.current = onStatus;
    onDevicesRef.current = onDevices;
  });

  // Poll the connected-device list while the server is on, so the PC's Settings
  // shows who's connected / trusted in near-real-time.
  React.useEffect(() => {
    if (!enabled) {
      onDevicesRef.current?.([]);
      return;
    }
    const api = bridge();
    if (!api?.remoteDevices) return;
    let alive = true;
    const poll = () => {
      api.remoteDevices!()
        .then((d) => { if (alive) onDevicesRef.current?.(d || []); })
        .catch(() => {});
    };
    poll();
    const iv = window.setInterval(poll, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [enabled]);

  // Apply phone commands to the live transport. Subscribed once; reads the ref.
  React.useEffect(() => {
    const api = bridge();
    if (!api?.onRemoteCommand) return;
    return api.onRemoteCommand((raw) => {
      const cmd = parseRemoteCommand(raw);
      if (cmd) applyRemoteCommand(cmd, transportRef.current);
    });
  }, []);

  // Start / stop the server as the toggle flips. Seeds the library + status.
  React.useEffect(() => {
    const api = bridge();
    if (!api?.remoteStart) {
      onStatusRef.current?.(null);
      return;
    }
    let cancelled = false;
    if (enabled) {
      api.remoteStart()
        .then((status) => {
          if (cancelled) return;
          onStatusRef.current?.(status);
          api.remoteSetLibrary?.(buildRemoteLibrary(playlistRef.current));
          api.remoteSetVideos?.(buildRemoteVideoLibrary(videosRef.current));
        })
        .catch((e) => {
          if (!cancelled) onStatusRef.current?.({ running: false, ip: null, port: null, url: null, error: String(e) });
        });
    } else {
      api.remoteStop?.().finally(() => { if (!cancelled) onStatusRef.current?.(null); });
    }
    return () => { cancelled = true; };
  }, [enabled]);

  // Keep the phone's browsable library in sync (import/remove/dedupe).
  React.useEffect(() => {
    if (!enabled) return;
    bridge()?.remoteSetLibrary?.(buildRemoteLibrary(playlist));
  }, [enabled, playlist]);

  // Keep the phone's video list in sync (video import/remove).
  React.useEffect(() => {
    if (!enabled) return;
    bridge()?.remoteSetVideos?.(buildRemoteVideoLibrary(videoList));
  }, [enabled, videoList]);

  // Push now-playing to phones. Control-field changes push immediately; bare
  // progress ticks (which fire ~4x/sec) are throttled to ~1/sec so the SSE
  // channel isn't spammed while scrubbing stays responsive.
  const lastPushRef = React.useRef({ at: 0, key: '' });
  React.useEffect(() => {
    if (!enabled) return;
    const api = bridge();
    if (!api?.remotePushState) return;
    const state = buildRemoteState(player);
    const key = [
      state.trackId, state.isPlaying, Math.round(state.volume * 100), state.isMuted, Math.round(state.duration),
      state.isShuffle, state.repeatMode,
    ].join('|');
    const now = Date.now();
    if (key !== lastPushRef.current.key || now - lastPushRef.current.at > 900) {
      lastPushRef.current = { at: now, key };
      api.remotePushState(state);
    }
    // player is intentionally read fresh each render; the primitive deps below are
    // what actually change and gate the push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, player.currentTrack?.id, player.isPlaying, player.progress, player.duration, player.volume, player.isMuted, player.isShuffle, player.repeatMode]);
}
