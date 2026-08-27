// Pure LRC-lyrics parsing. Turns timestamped text ("[mm:ss.xx] line") into the
// sorted { text, timestamp }[] the player follows, stripping the tokens. Returns
// [] when there are no timestamps, so callers can fall back to plain lyrics.
// Shared by the .lrc import AND the paste box (paste of copied-with-timestamps
// lyrics should sync, not show the raw [..] tokens).

export interface SyncedLine {
  text: string;
  timestamp: number;
}

/**
 * The synced lyrics to actually display for a track, or null if it has none to
 * follow. Prefers real `syncedLyrics`, but falls back to parsing timestamps out
 * of plain `lyrics` — many files embed "[mm:ss] line" text in USLT, which would
 * otherwise show raw tokens and never scroll. Pure; callers memoize on the two
 * fields.
 */
export function resolveSyncedLyrics(
  track: { lyrics?: string; syncedLyrics?: SyncedLine[] } | null | undefined
): SyncedLine[] | null {
  if (!track) return null;
  if (track.syncedLyrics && track.syncedLyrics.length > 0) return track.syncedLyrics;
  if (track.lyrics) {
    const parsed = parseTimestampedLyrics(track.lyrics);
    if (parsed.length > 0) return parsed;
  }
  return null;
}

/**
 * Index of the line playing at `progress`, or -1 before the first one. Lines are
 * sorted by timestamp, so this is "the last line whose time has passed".
 *
 * Extracted so the lyrics view and the MEANING corner can't disagree about which
 * line is current — a corner explaining the previous line would be worse than no
 * corner at all.
 */
export function activeLineIndex(lines: SyncedLine[], progress: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (progress >= lines[i].timestamp) active = i;
    else break;
  }
  return active;
}

const TOKEN = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseTimestampedLyrics(text: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of text.split('\n')) {
    const times: number[] = [];
    let m: RegExpExecArray | null;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(raw))) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ?? '0';
      // Normalise fractional seconds to ms: 1 digit → ×100, 2 → ×10, 3 → ×1.
      const ms = parseInt(frac, 10) * (frac.length === 1 ? 100 : frac.length === 2 ? 10 : 1);
      times.push(min * 60 + sec + ms / 1000);
    }
    const lyric = raw.replace(TOKEN, '').trim();
    for (const t of times) out.push({ text: lyric, timestamp: t });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}
