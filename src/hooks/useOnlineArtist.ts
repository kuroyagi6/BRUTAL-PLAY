// The single opt-in that gates the online artist-profile lookup (bio + photo +
// tags). Read by the Settings toggle, the artist page, and the library-wide
// photo prefetch. Default OFF: turning it on means artist names get
// sent to MusicBrainz/Wikipedia/Deezer, which is the user's call to make.
//
// The storage key and its '-changed' event name are unchanged from when this
// hook held the logic itself, so an opt-in set by an older build survives.
import { makeFlagHook } from './useLocalFlag';

export const useOnlineArtist = makeFlagHook('brutal-onlineArtist');
