// React face of the thumb cache (see services/thumbCache.ts): returns a
// lookup you call per tile/row. Undefined while a thumb is still generating —
// the caller shows its icon placeholder, and the subscription re-renders the
// view as batches of thumbs become ready.
import React from 'react';
import { getThumb, requestThumb, subscribeThumbs, thumbsVersion } from '../services/thumbCache';

export function useCoverThumbs() {
  const version = React.useSyncExternalStore(subscribeThumbs, thumbsVersion);
  return React.useCallback(
    (track?: { id: string; coverUrl?: string } | null): string | undefined => {
      if (!track?.coverUrl) return undefined;
      const thumb = getThumb(track.id);
      if (thumb === undefined) {
        // Requested from render on purpose: it's idempotent and per-row
        // effects would cost more than they save. On-screen = urgent.
        requestThumb(track.id, track.coverUrl, true);
        return undefined;
      }
      // '' = generation failed once; use the full-size cover rather than a hole.
      return thumb || track.coverUrl;
    },
    [version],
  );
}
