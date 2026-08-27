// How a Track becomes something an <audio> element can play.
//
// Two strategies, selected by PlaybackMode:
//
//   'buffer' (default) — read the whole native file over IPC and hand the
//     element an in-memory blob: URL. Blob URLs are natively seekable, so
//     scrubbing can never hit a range-request bug. Costs RAM and a full read
//     on every track change, proportional to file size.
//
//   'stream' — hand the element the local-media:// URL and let Chromium's
//     media loader fetch byte ranges on demand, like a real media player.
//     Constant memory, instant track change. Depends on the protocol handler
//     in electron/main.cjs returning correct 206 responses with strong
//     validators; get that wrong and seeking breaks.
//
// Kept as a pure function (deps injected) so both strategies are testable
// without an <audio> element, an Electron main process, or the DOM.
import type { Track } from '../types';

export type PlaybackMode = 'buffer' | 'stream';

export interface PlayableSource {
  src: string;
  /** True when `src` is a blob: URL this function minted — the caller owns revoking it. */
  isObjectUrl: boolean;
}

export interface SourceDeps {
  /** The `read-audio-file` IPC bridge. Absent in a browser (non-Electron) context. */
  readAudioFile?: (nativePath: string) => Promise<ArrayBuffer>;
  createObjectURL?: (blob: Blob) => string;
}

/** A native, on-disk track served through the local-media:// protocol. */
export function isNativeTrack(track: Track): boolean {
  return track.url.startsWith('local-media:') && !!track.nativePath;
}

/**
 * Resolve the playable src for a track.
 *
 * Uploaded tracks already carry a usable blob: URL from IndexedDB and are
 * returned untouched in both modes. Native tracks fall back to streaming
 * whenever buffering isn't possible (no IPC bridge), because a src that plays
 * without seeking beats no src at all.
 */
export async function resolvePlayableSource(
  track: Track,
  mode: PlaybackMode,
  deps: SourceDeps = {}
): Promise<PlayableSource> {
  const { readAudioFile, createObjectURL = URL.createObjectURL.bind(URL) } = deps;

  if (mode === 'buffer' && isNativeTrack(track) && readAudioFile) {
    const data = await readAudioFile(track.nativePath!);
    return { src: createObjectURL(new Blob([data])), isObjectUrl: true };
  }

  return { src: track.url, isObjectUrl: false };
}
