// Pure, framework-free contract shared by the phone remote and the desktop app.
// Kept dependency-free (no React/DOM/Electron) so both the renderer bridge hook
// and a test can import it, and so the "what can the remote do" surface has ONE
// definition. See src/remote/useRemoteServer.ts (renderer side) and
// electron/remoteServer.cjs (main-process HTTP server).

import type { Track, VideoItem } from '../types';

/** Now-playing snapshot pushed PC -> phone over the SSE channel. */
export interface RemoteState {
  trackId: string | null;
  name: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  progress: number;
  duration: number;
  /** 0..1 */
  volume: number;
  isMuted: boolean;
  isShuffle: boolean;
  repeatMode: 'none' | 'one' | 'all';
}

/** One command sent phone -> PC. `value` is only read where noted. */
export type RemoteCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; value: number }
  | { type: 'volume'; value: number }
  | { type: 'mute' }
  | { type: 'shuffle' }
  | { type: 'repeat' }
  // Phone picks a library track for the PC to play (the "different zones" case:
  // the phone can queue the PC to a different song than it's playing itself).
  | { type: 'playTrack'; value: string };

/** The slice of the audio engine a remote command is allowed to drive. */
export interface RemoteTransport {
  isPlaying: boolean;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  /** Play a specific library track (by id) on the PC. No-op for unknown ids. */
  playTrackId: (id: string) => void;
}

/** What the phone's "play on this phone" list needs (NO disk paths). */
export interface RemoteTrackInfo {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration?: number;
}

/** Index entry main keeps so it can stream a track by id. Includes the path. */
export interface RemoteLibraryEntry extends RemoteTrackInfo {
  nativePath?: string;
}

/**
 * Video index entry the phone browses. A parallel path to the audio library —
 * videos never touch the audio engine (see the video layer). `ext` lets the
 * phone warn about formats a mobile browser can't decode (mkv/mov) BEFORE it
 * tries to play a blank <video>. Includes the disk path so main can stream it.
 */
export interface RemoteVideoEntry {
  id: string;
  name: string;
  duration?: number;
  /** Lower-case extension incl. dot, e.g. ".mp4" — drives the phone's codec hint. */
  ext?: string;
  nativePath?: string;
}

/** Build the SSE payload from the live player fields. Pure. */
export function buildRemoteState(p: {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isShuffle: boolean;
  repeatMode: 'none' | 'one' | 'all';
}): RemoteState {
  return {
    trackId: p.currentTrack?.id ?? null,
    name: p.currentTrack?.name ?? '',
    artist: p.currentTrack?.artist ?? '',
    album: p.currentTrack?.album ?? '',
    isPlaying: p.isPlaying,
    progress: p.progress,
    duration: p.duration,
    volume: p.volume,
    isMuted: p.isMuted,
    isShuffle: p.isShuffle,
    repeatMode: p.repeatMode,
  };
}

/** Map the library to the index main serves (safe subset + path for streaming). */
export function buildRemoteLibrary(tracks: Track[]): RemoteLibraryEntry[] {
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    nativePath: t.nativePath,
  }));
}

/** Lower-case file extension incl. the dot (".mp4"), or '' if none. */
function extOf(p: string | undefined): string {
  if (!p) return '';
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

/** Map the video library to the index main serves for LAN video streaming. */
export function buildRemoteVideoLibrary(videos: VideoItem[]): RemoteVideoEntry[] {
  return videos.map((v) => ({
    id: v.id,
    name: v.name,
    duration: v.duration,
    ext: extOf(v.nativePath),
    nativePath: v.nativePath,
  }));
}

/**
 * Apply a validated command to the transport. Pure w.r.t. its inputs (only calls
 * the callbacks it is given), so a test can assert the mapping with spies. play/
 * pause are expressed via togglePlay + the current isPlaying so this never needs
 * its own setter into the engine.
 */
export function applyRemoteCommand(cmd: RemoteCommand, t: RemoteTransport): void {
  switch (cmd.type) {
    case 'toggle':
      t.togglePlay();
      break;
    case 'play':
      if (!t.isPlaying) t.togglePlay();
      break;
    case 'pause':
      if (t.isPlaying) t.togglePlay();
      break;
    case 'next':
      t.playNext();
      break;
    case 'prev':
      t.playPrev();
      break;
    case 'seek':
      if (typeof cmd.value === 'number' && isFinite(cmd.value)) t.seek(Math.max(0, cmd.value));
      break;
    case 'volume':
      if (typeof cmd.value === 'number' && isFinite(cmd.value)) {
        t.setVolume(Math.min(1, Math.max(0, cmd.value)));
      }
      break;
    case 'mute':
      t.toggleMute();
      break;
    case 'shuffle':
      t.toggleShuffle();
      break;
    case 'repeat':
      t.toggleRepeat();
      break;
    case 'playTrack':
      if (typeof cmd.value === 'string' && cmd.value) t.playTrackId(cmd.value);
      break;
  }
}

/** Coerce arbitrary JSON from the network into a RemoteCommand, or null. */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = (raw as any).type;
  const value = (raw as any).value;
  switch (type) {
    case 'toggle':
    case 'play':
    case 'pause':
    case 'next':
    case 'prev':
    case 'mute':
    case 'shuffle':
    case 'repeat':
      return { type };
    case 'seek':
    case 'volume':
      return { type, value: Number(value) };
    case 'playTrack':
      return value == null || value === '' ? null : { type, value: String(value) };
    default:
      return null;
  }
}
