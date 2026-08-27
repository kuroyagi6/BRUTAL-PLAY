// Shared domain types. Keep these free of any React/DOM/service coupling so
// every layer (UI, hooks, services, pure logic) can depend on data shapes
// without depending on each other.

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  url: string;
  coverUrl?: string;
  /** Content hash of the cover image. Tracks sharing art share one Blob + URL. */
  coverHash?: string;
  bitrate?: number;
  sampleRate?: number;
  codec?: string;
  duration?: number;
  lyrics?: string;
  syncedLyrics?: { text: string; timestamp: number }[];
  genre?: string;
  nativePath?: string;
  /**
   * Content advisory. `true` = explicit, `false` = clean, `undefined` = unmarked
   * (treated as non-explicit by the rating filter). Filled best-effort from tags
   * and the "[Explicit]"/"[Clean]" title convention on import, and overridable by
   * hand in the library. See library/explicit.ts.
   */
  explicit?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

/**
 * An internet-radio / stream station. EXPERIMENTAL and deliberately separate from
 * `Track`: a station is a live `http(s)` stream URL, never a library track, never
 * enters the play queue, the wire graph, or the EQ/crossfade engine. It plays
 * through its own dedicated <audio> element (see hooks/useStations.ts) — the only
 * coupling to the music engine is "starting a station pauses music, and starting
 * music stops the station", mirroring the video layer's "video pauses music" rule.
 * `streamUrl` has no duration and isn't seekable, so the transport shows LIVE.
 */
export interface Station {
  id: string;
  name: string;
  /** Live http(s) stream URL handed straight to an <audio> element. */
  streamUrl: string;
  /** Optional logo/icon URL shown on the desktop tile. */
  faviconUrl?: string;
  createdAt: number;
}

/**
 * An artist profile fetched from an online source (MusicBrainz + Wikipedia) as a
 * fallback when the local tags carry only an artist name. Deliberately separate
 * from `Track`: it is looked up per unique artist name, cached in IndexedDB, and
 * never enters the audio engine or the play queue. Every field is optional
 * because the source coverage varies — a resolver may find a name and nothing
 * else. `sources` carries attribution links (required by MusicBrainz/Wikipedia).
 */
export interface ArtistProfile {
  /** Lowercased artist name used as the cache key. */
  key: string;
  /** Canonical display name (from MusicBrainz, else the queried name). */
  name: string;
  /** MusicBrainz artist id, when matched. */
  mbid?: string;
  /** Short bio/summary (Wikipedia extract). */
  bio?: string;
  /** Full-size remote photo (Deezer 500px, else the Wikipedia page image). */
  imageUrl?: string;
  /**
   * 250px remote photo for list rows (Spotlight avatars). Deezer only — there's
   * no point pulling a 500px hero for a 32px square. Absent when the photo came
   * from Wikipedia, which has no predictable thumbnail size.
   */
  thumbUrl?: string;
  /** Genre/style tags from MusicBrainz. */
  tags?: string[];
  country?: string;
  /** MusicBrainz disambiguation comment, e.g. "US rapper". */
  disambiguation?: string;
  /** Attribution links shown in the UI. */
  sources: { label: string; url: string }[];
  /** When this profile was resolved (epoch ms). */
  fetchedAt: number;
  /** True when the lookup ran but found nothing — cached so we don't refetch. */
  notFound?: boolean;
  /**
   * Resolver version that produced this row (PROFILE_VERSION in
   * services/artistProfile). Rows from an older resolver are treated as a cache
   * MISS, not as truth — otherwise a profile cached before the photo source
   * existed would keep serving back "no picture" forever. Absent on v1 rows.
   */
  v?: number;
}

/**
 * EXPERIMENTAL: a saved YouTube target — a single video or a whole playlist —
 * played through YouTube's embedded IFrame player, NOT the audio engine. There is
 * no stream URL and no file: the audio lives inside a cross-origin iframe, so it
 * never touches the queue, EQ, visualizer, or crossfade graph (that isolation is
 * a hard browser boundary, not a choice). Kept apart from `Track`/`VideoItem` for
 * the same reason those two are kept apart. `ytId` is the YouTube video id (11
 * chars) or playlist id (starts PL/OL/UU/…); `kind` says which.
 */
export interface YouTubeItem {
  id: string;
  name: string;
  kind: 'video' | 'playlist';
  /** YouTube video id or playlist id (see `kind`). */
  ytId: string;
  createdAt: number;
}

/**
 * A video file in the library. Deliberately separate from `Track`: video never
 * enters the audio engine, the play queue, or the EQ/crossfade graph. Videos are
 * always native files streamed from disk over `local-media://` (never loaded
 * whole into a blob: URL — they can be gigabytes), so `nativePath` is required.
 * `duration`/`width`/`height` are best-effort, filled from the <video> element
 * the first time it loads and persisted back.
 */
export interface VideoItem {
  id: string;
  name: string;
  /** local-media:/// URL the <video> element streams (with Range/seeking). */
  url: string;
  /** Full on-disk path. Always present — videos have no browser-blob path. */
  nativePath: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
}
