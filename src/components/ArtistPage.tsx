import React from 'react';
import { motion } from 'motion/react';
import { Play, Shuffle, Music, Disc, User, Unplug, Clock, RefreshCw, Pin, PinOff } from 'lucide-react';
import type { Track } from '../types';
import { usePlayer } from '../player/PlayerContext';
import { useOnlineArtist } from '../hooks/useOnlineArtist';
import { useArtistProfile } from '../hooks/useArtistProfile';
import { ArtistProfileCard } from './ArtistProfileCard';
import { RatingBadge } from './RatingBadge';
import { splitArtistTracks, artistStats, artistAlbums, formatRuntime } from '../library/artistPage';
import { sortTracks, type LibrarySortMode } from '../library/trackSort';
import { formatTime } from '../utils/format';

// The artist page: everything by one artist, in one place. Driven by
// selectedArtist — a destination you navigate to (from Spotlight, or the artists
// grid), not a panel that follows playback. It is now the only artist surface —
// the Inspector's ARTIST tab, which answered "who's playing right now?", went
// with the Inspector window. The profile still renders through
// ArtistProfileCard, which keeps its two variants for that reason.
//
// Track rows here are a single designed layout rather than the library's four
// view modes: this is a destination page, not a browse list. It does honour the
// library's SORT mode, which still means something for a discography.

// Stat and TrackRow are declared HERE, at module scope, and must stay here.
//
// They used to live inside ArtistPage's body. That silently re-created both
// component types on every single render, so React saw a different type in the
// same slot and threw away each row's DOM to build it again — the rows visibly
// flickered as their motion hover animation restarted and every cover <img>
// re-decoded. Anything that re-rendered the page (playback advancing the current
// track, the artist profile resolving, a sort change) made the whole list blink.
const Stat: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({
  icon,
  value,
  label,
}) => (
  <div className="flex items-center gap-2 min-w-0">
    <span className="text-brutal-neon shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="font-display text-lg leading-none text-brutal-white">{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/40 truncate">
        {label}
      </p>
    </div>
  </div>
);

interface TrackRowProps {
  track: Track;
  /** The list this row belongs to — it becomes the queue when the row is played. */
  list: Track[];
  index: number;
  /** APPEARS ON shows the credit instead of the album: whose track this is. */
  showArtist?: boolean;
  /** This row's index in the MASTER playlist, or -1. */
  global: number;
  offline: boolean;
  current: boolean;
  onPlay: (list: Track[], index: number) => void;
}

// memo keeps a row from re-rendering when a sibling changes — with the type now
// stable, the current-track highlight moving no longer touches the other rows.
const TrackRow: React.FC<TrackRowProps> = React.memo(
  ({ track, list, index, showArtist, offline, current, onPlay }: TrackRowProps) => (
    <motion.div
      whileHover={{ x: 5 }}
      onClick={() => onPlay(list, index)}
      className={`brutal-card p-3 cursor-pointer transition-all flex items-center gap-4 group hover:bg-brutal-white/5 ${
        offline ? 'opacity-40 ' : ''
      }${current ? 'border-brutal-neon shadow-brutal-neon' : 'border-brutal-white'}`}
    >
      <div className="w-10 h-10 flex items-center justify-center border-2 border-brutal-white overflow-hidden shrink-0">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            className="w-full h-full object-cover"
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Music size={18} className="opacity-20" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold uppercase truncate text-sm leading-tight group-hover:text-brutal-neon transition-colors flex items-center gap-2">
          <span className="truncate">{track.name}</span>
          <RatingBadge track={track} />
        </p>
        <p className="font-mono text-[10px] uppercase opacity-50 truncate">
          {showArtist ? track.artist : track.album || '—'}
        </p>
      </div>
      {offline && <Unplug size={12} className="text-red-500 shrink-0" />}
      {track.duration ? (
        <span className="font-mono text-[10px] opacity-40 shrink-0 tabular-nums">
          {formatTime(track.duration)}
        </span>
      ) : null}
    </motion.div>
  )
);

interface ArtistPageProps {
  artist: string;
  /** The whole library. Splitting it is this page's job. */
  tracks: Track[];
  librarySortMode: LibrarySortMode;
  /** Jump to an album's own page from the albums row. */
  onSelectAlbum: (album: string) => void;
  isOffline: (track: Track) => boolean;
  /** Is this artist already a desktop icon? */
  pinned?: boolean;
  /** Pin/unpin this artist to the desktop. Omitted = the control is hidden. */
  onTogglePin?: () => void;
}

export const ArtistPage: React.FC<ArtistPageProps> = ({
  artist,
  tracks,
  librarySortMode,
  onSelectAlbum,
  isOffline,
  pinned = false,
  onTogglePin,
}) => {
  const { playTrack, currentIndex, shuffle, toggleShuffle } = usePlayer();
  const [enabled, setEnabled] = useOnlineArtist();
  const { profile, loading, error, notFound, refetch } = useArtistProfile(artist, enabled);

  // playTrack takes the track's index in the MASTER playlist, plus the id order
  // that becomes the queue — so a page-local list still plays as its own queue.
  const indexById = React.useMemo(() => {
    const m = new Map<string, number>();
    tracks.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [tracks]);

  const { own, appearsOn } = React.useMemo(
    () => splitArtistTracks(tracks, artist),
    [tracks, artist]
  );
  const ownSorted = React.useMemo(() => sortTracks(own, librarySortMode), [own, librarySortMode]);
  const appearsSorted = React.useMemo(
    () => sortTracks(appearsOn, librarySortMode),
    [appearsOn, librarySortMode]
  );

  // Stats and albums describe the artist's OWN body of work, not their guest
  // spots — an appearance isn't their album.
  const stats = React.useMemo(() => artistStats(own), [own]);
  const albums = React.useMemo(() => artistAlbums(own), [own]);

  const known = !!artist && !/^(unknown|various)/i.test(artist);

  // Stable across renders so the memoized rows aren't invalidated by a new
  // closure every time the page re-renders.
  const play = React.useCallback(
    (list: Track[], index: number) => {
      const track = list[index];
      if (!track) return;
      const global = indexById.get(track.id);
      if (global === undefined) return;
      playTrack(global, list.map((t) => t.id));
    },
    [indexById, playTrack]
  );

  const playAll = () => play(ownSorted, 0);

  const shuffleAll = () => {
    if (!ownSorted.length) return;
    // Turn shuffle mode on so the REST of the queue keeps shuffling, not just
    // this first pick — otherwise the button lies after one track.
    if (!shuffle) toggleShuffle();
    play(ownSorted, Math.floor(Math.random() * ownSorted.length));
  };

  const row = (track: Track, list: Track[], i: number, showArtist?: boolean) => {
    const global = indexById.get(track.id) ?? -1;
    return (
      <TrackRow
        key={track.id}
        track={track}
        list={list}
        index={i}
        showArtist={showArtist}
        global={global}
        offline={isOffline(track)}
        current={currentIndex === global}
        onPlay={play}
      />
    );
  };

  return (
    <div className="overflow-y-auto pr-2 h-full custom-scrollbar pb-4 space-y-6">
      {/* HERO — photo + bio + tags + attribution */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-white/40">
              ARTIST
            </p>
            <h2 className="font-display text-3xl md:text-4xl uppercase tracking-tighter text-brutal-white leading-none truncate">
              {artist}
            </h2>
          </div>
          <div className="flex gap-2 shrink-0">
            {/* Pin the artist to the desktop as a wirable icon — it then chains
                with folders/playlists/videos like any other node. */}
            {onTogglePin && (
              <button
                onClick={onTogglePin}
                title={
                  pinned
                    ? 'Remove this artist from the desktop'
                    : 'Pin this artist to the desktop as a wirable icon'
                }
                className={`p-2 border-2 flex items-center gap-2 font-mono text-[10px] uppercase transition-colors ${
                  pinned
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                <span className="hidden sm:inline">{pinned ? 'UNPIN' : 'PIN_TO_DESKTOP'}</span>
              </button>
            )}
            {enabled && known && (
              <button
                onClick={refetch}
                disabled={loading}
                title="Re-fetch profile"
                className="p-2 border-2 border-brutal-white/20 hover:border-brutal-neon transition-colors disabled:opacity-40"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
        </div>

        <ArtistProfileCard
          profile={profile}
          loading={loading}
          error={error}
          notFound={notFound}
          enabled={enabled}
          onEnable={() => setEnabled(true)}
          refetch={refetch}
          known={known}
          variant="hero"
        />
      </div>

      {/* STATS — from the library, no network */}
      <div className="flex flex-wrap gap-x-8 gap-y-3 p-3 border-2 border-brutal-white/10">
        <Stat icon={<Music size={16} />} value={String(stats.trackCount)} label="TRACKS" />
        <Stat icon={<Disc size={16} />} value={String(stats.albumCount)} label="ALBUMS" />
        <Stat icon={<Clock size={16} />} value={formatRuntime(stats.totalDuration)} label="RUNTIME" />
        {appearsOn.length > 0 && (
          <Stat icon={<User size={16} />} value={String(appearsOn.length)} label="APPEARANCES" />
        )}
        {profile?.country && (
          <Stat icon={<User size={16} />} value={profile.country} label="ORIGIN" />
        )}
      </div>

      {/* TRANSPORT */}
      {ownSorted.length > 0 && (
        <div className="flex gap-3">
          <button
            onClick={playAll}
            className="brutal-btn bg-brutal-neon text-brutal-black border-brutal-black flex items-center gap-2 text-xs"
          >
            <Play size={14} /> PLAY_ALL
          </button>
          <button onClick={shuffleAll} className="brutal-btn flex items-center gap-2 text-xs">
            <Shuffle size={14} /> SHUFFLE
          </button>
        </div>
      )}

      {/* ALBUMS */}
      {albums.length > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-neon/70 mb-2">
            ALBUMS // {albums.length}
          </p>
          <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2">
            {albums.map((a) => (
              <motion.div
                key={a.album}
                whileHover={{ scale: 1.04, rotate: -1 }}
                onClick={() => onSelectAlbum(a.album)}
                className="w-32 shrink-0 cursor-pointer group"
              >
                <div className="w-32 h-32 border-2 border-brutal-white overflow-hidden bg-brutal-white/5 flex items-center justify-center">
                  {a.coverUrl ? (
                    <img
                      src={a.coverUrl}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                      alt=""
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <Disc size={28} className="opacity-20" />
                  )}
                </div>
                <p className="font-display text-[10px] uppercase truncate mt-1 group-hover:text-brutal-neon transition-colors">
                  {a.album}
                </p>
                <p className="font-mono text-[9px] uppercase opacity-40">{a.count} TRACKS</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* OWN TRACKS */}
      <div>
        <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-neon/70 mb-2">
          TRACKS // {ownSorted.length}
        </p>
        {ownSorted.length === 0 ? (
          <p className="font-mono text-[10px] uppercase text-brutal-white/40 p-3 border-2 border-dashed border-brutal-white/20">
            NO_TRACKS_TAGGED_TO_THIS_ARTIST
          </p>
        ) : (
          <div className="space-y-2">{ownSorted.map((track, i) => row(track, ownSorted, i))}</div>
        )}
      </div>

      {/* APPEARS ON — the features an exact-tag match used to hide entirely */}
      {appearsSorted.length > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-neon/70 mb-2">
            APPEARS ON // {appearsSorted.length}
          </p>
          <div className="space-y-2">
            {appearsSorted.map((track, i) => row(track, appearsSorted, i, true))}
          </div>
        </div>
      )}
    </div>
  );
};
