// The opt-in that gates online lyrics lookup (LRCLIB). Separate from the artist
// opt-in on purpose: they send different data to different services, so wanting
// synced lyrics shouldn't silently sign you up for artist lookups (or the
// reverse). Default OFF — a lookup sends the track title + artist to LRCLIB.
import { makeFlagHook } from './useLocalFlag';

export const useOnlineLyrics = makeFlagHook('brutal-onlineLyrics');

/**
 * Auto-fetch lyrics when a track with none starts playing, instead of waiting
 * for the FETCH button. Gated by (and meaningless without) useOnlineLyrics — it
 * can never make a request on its own.
 *
 * DEFAULTS ON (2026-08-14): pressing FETCH once per song was the single most
 * tedious thing about the lyrics window, and by the time this flag is read the
 * user has already opted into sending titles to LRCLIB. It still changes *when*
 * that happens — playing an album now costs a request per track — so it stays a
 * separate switch, and an explicit OFF is remembered.
 */
export const useAutoLyrics = makeFlagHook('brutal-autoLyrics', true);
