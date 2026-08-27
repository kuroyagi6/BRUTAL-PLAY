import React from 'react';
import type { Track } from '../types';

/**
 * The visible content-advisory sign for a track: a filled "E" for explicit, an
 * outlined "CLEAN" for tracks marked clean, and nothing at all for unmarked ones
 * (so a library that was never rated stays quiet). This is display only — the
 * rating filter and the hand-marking toggle live in LibraryView; both read the
 * same `track.explicit` field this renders.
 */
export function RatingBadge({ track, className = '' }: { track: Track; className?: string }) {
  if (track.explicit === true) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 w-4 h-4 bg-brutal-white text-brutal-black font-display text-[11px] leading-none ${className}`}
        title="Explicit"
        aria-label="Explicit"
      >
        E
      </span>
    );
  }
  if (track.explicit === false) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 font-mono text-[8px] uppercase tracking-wider border border-brutal-white/40 text-brutal-white/50 px-1 py-[1px] ${className}`}
        title="Clean"
        aria-label="Clean"
      >
        CLEAN
      </span>
    );
  }
  return null;
}
