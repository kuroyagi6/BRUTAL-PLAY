// One place that understands music-metadata. Both import paths (uploaded File
// and native path via the local-media protocol) parse tags the same way, so the
// picture/lyrics/SYLT extraction lives here instead of being copy-pasted.
import * as mm from 'music-metadata-browser';
import type { Track } from '../types';
import { explicitFromNativeTags, explicitFromText } from '../library/explicit';

export interface ParsedMeta {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  bitrate?: number;
  sampleRate?: number;
  codec?: string;
  duration?: number;
  lyrics?: string;
  syncedLyrics?: { text: string; timestamp: number }[];
  coverBlob?: Blob;
  /** Content hash of coverBlob. Only the native scan provides it (main hashes
   *  the bytes it already holds); browser uploads have no hash and stay unshared. */
  coverHash?: string;
  /** iTunes content advisory, when the file's tags carry one. See library/explicit. */
  explicit?: boolean;
}

function extract(metadata: mm.IAudioMetadata): ParsedMeta {
  const { common, format } = metadata;

  const meta: ParsedMeta = {
    title: common.title || undefined,
    artist: common.artist || undefined,
    album: common.album || undefined,
    genre: common.genre && common.genre.length > 0 ? common.genre.join(', ') : undefined,
    bitrate: format.bitrate,
    sampleRate: format.sampleRate,
    codec: format.codec,
    duration: format.duration,
    // Prefer the file's own iTunes advisory tag; fall back to the "[Explicit]"
    // title/album convention only when no tag is present.
    explicit:
      explicitFromNativeTags(metadata.native as any) ??
      explicitFromText(common.title || undefined, common.album || undefined),
  };

  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0];
    meta.coverBlob = new Blob([new Uint8Array(pic.data)], { type: pic.format });
  }

  if (common.lyrics && common.lyrics.length > 0) {
    meta.lyrics = common.lyrics[0] as unknown as string;
  }

  // SYLT = synced lyrics, stored in format-specific native tags.
  const nativeTags = metadata.native;
  for (const tagFormat in nativeTags) {
    const tags = nativeTags[tagFormat] as any[];
    if (Array.isArray(tags)) {
      const syltTag = tags.find((t: any) => t.id === 'SYLT');
      if (syltTag && syltTag.value && Array.isArray(syltTag.value.syncText)) {
        meta.syncedLyrics = syltTag.value.syncText.map((sylt: any) => ({
          text: sylt.text || '',
          timestamp: sylt.timestamp / 1000,
        }));
        break;
      }
    }
  }

  return meta;
}

/** Parse an uploaded File (browser drag/drop or file input). */
export async function parseFromBlob(file: File): Promise<ParsedMeta> {
  return extract(await mm.parseBlob(file));
}

/** Parse a native file via a URL the renderer can fetch (local-media protocol). */
export async function parseFromUrl(url: string): Promise<ParsedMeta> {
  return extract(await mm.fetchFromUrl(url));
}

/** One entry as returned by the main process `scan-metadata` IPC channel. */
export interface ScannedMeta extends Omit<ParsedMeta, 'coverBlob' | 'coverHash'> {
  path: string;
  cover?: { data: Uint8Array; format: string; hash: string };
  error?: string;
}

/**
 * Adapt a main-process scan result into a ParsedMeta. Main can't send a Blob
 * over IPC, so cover art arrives as raw bytes and is wrapped here.
 */
export function fromScan(scanned: ScannedMeta): ParsedMeta {
  const { path, cover, error, ...meta } = scanned;
  return cover
    ? { ...meta, coverBlob: new Blob([cover.data], { type: cover.format }), coverHash: cover.hash }
    : meta;
}

/** Default cover URL strategy: one unshared object URL per blob. */
const ownObjectUrl = (meta: ParsedMeta): string | undefined =>
  meta.coverBlob ? URL.createObjectURL(meta.coverBlob) : undefined;

/**
 * Overlay parsed metadata onto a track, applying the app's default labels.
 * Mutates `track`.
 *
 * `makeCoverUrl` is injected so the library layer can hand back a *shared*,
 * refcounted URL for art it has already seen (see library/coverCache.ts) rather
 * than minting a duplicate Blob per track. The default keeps the simple
 * one-blob-per-track behavior used by browser uploads, which carry no hash.
 */
export function applyMeta(
  track: Track,
  meta: ParsedMeta,
  fallbackName: string,
  makeCoverUrl: (meta: ParsedMeta) => string | undefined = ownObjectUrl
): void {
  track.coverUrl = makeCoverUrl(meta);
  track.coverHash = meta.coverHash;
  track.name = meta.title || fallbackName;
  track.artist = meta.artist || 'Unknown Artist';
  track.album = meta.album || 'Unknown Album';
  track.bitrate = meta.bitrate;
  track.sampleRate = meta.sampleRate;
  track.codec = meta.codec;
  track.duration = meta.duration;
  track.lyrics = meta.lyrics;
  track.syncedLyrics = meta.syncedLyrics;
  track.genre = meta.genre || 'Unknown Genre';
  // The native-scan path (electron) doesn't read the advisory tag, so fall back
  // to the "[Explicit]"/"[Clean]" title convention using the resolved name/album.
  track.explicit = meta.explicit ?? explicitFromText(track.name, track.album);
}
