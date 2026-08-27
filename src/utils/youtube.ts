// Turn whatever a user pastes into a { kind, ytId } we can embed. Pure string
// work — no network, no DOM — so it is trivially testable and safe to call from
// the add dialog on every keystroke.
//
// Accepts the common YouTube URL shapes plus a bare id:
//   https://www.youtube.com/watch?v=VIDEOID
//   https://youtu.be/VIDEOID
//   https://www.youtube.com/playlist?list=PLAYLISTID
//   https://www.youtube.com/watch?v=VIDEOID&list=PLAYLISTID   (→ playlist)
//   https://www.youtube.com/embed/VIDEOID
//   https://www.youtube.com/shorts/VIDEOID
//   VIDEOID (11-char bare id)
//
// A `list=` param wins over `v=`: "watch?v=X&list=Y" is a video *in* a playlist,
// and the user who pasted it almost always means "play the playlist".

import type { YouTubeItem } from '../types';

export interface ParsedYouTube {
  kind: YouTubeItem['kind'];
  ytId: string;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// Playlist ids are longer and start with a known prefix (PL, OL, UU, RD, FL, LL…).
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,}$/;

/** Parse a pasted URL or id, or null if nothing usable is found. */
export function parseYouTube(input: string): ParsedYouTube | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare video id.
  if (VIDEO_ID.test(raw)) return { kind: 'video', ytId: raw };

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTube = host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtu.be';
  if (!isYouTube) return null;

  const list = url.searchParams.get('list');
  if (list && PLAYLIST_ID.test(list)) return { kind: 'playlist', ytId: list };

  // youtu.be/VIDEOID
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(id) ? { kind: 'video', ytId: id } : null;
  }

  // /playlist?list=... handled above; here handle /watch?v=, /embed/, /shorts/, /v/
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return { kind: 'video', ytId: v };

  const segs = url.pathname.split('/').filter(Boolean);
  if (segs.length >= 2 && ['embed', 'shorts', 'v', 'live'].includes(segs[0]) && VIDEO_ID.test(segs[1])) {
    return { kind: 'video', ytId: segs[1] };
  }

  return null;
}

/** The embeddable player URL for an item. Playlists use the `videoseries` embed. */
export function youTubeEmbedUrl(item: Pick<YouTubeItem, 'kind' | 'ytId'>, autoplay = true): string {
  const common = `enablejsapi=1&rel=0&playsinline=1${autoplay ? '&autoplay=1' : ''}`;
  if (item.kind === 'playlist') {
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(item.ytId)}&${common}`;
  }
  return `https://www.youtube.com/embed/${encodeURIComponent(item.ytId)}?${common}`;
}

/** Public thumbnail for a video id (no API key needed). Playlists have none. */
export function youTubeThumb(item: Pick<YouTubeItem, 'kind' | 'ytId'>): string | null {
  return item.kind === 'video' ? `https://img.youtube.com/vi/${item.ytId}/mqdefault.jpg` : null;
}

/** The canonical youtube.com link, for the "open on YouTube" fallback. */
export function youTubeWatchUrl(item: Pick<YouTubeItem, 'kind' | 'ytId'>): string {
  return item.kind === 'playlist'
    ? `https://www.youtube.com/playlist?list=${item.ytId}`
    : `https://www.youtube.com/watch?v=${item.ytId}`;
}
