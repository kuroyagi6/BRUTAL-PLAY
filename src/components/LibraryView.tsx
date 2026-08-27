import React from 'react';
import { motion } from 'motion/react';
import { Music, Volume2, Trash2, Disc, User, ListMusic, ChevronLeft, Zap, List, Bookmark, Plus, Unplug, Pin, PinOff } from 'lucide-react';
import type { Track, Playlist } from '../types';
import { formatTime } from '../utils/format';
import { useI18n } from '../i18n/LanguageContext';
import { sortTracks, type LibrarySortMode } from '../library/trackSort';
import { filterByRating, isExplicit, type RatingFilter } from '../library/explicit';
import { RatingBadge } from './RatingBadge';
import { usePlayer } from '../player/PlayerContext';
import { ShieldAlert } from 'lucide-react';
import { ArtistPage } from './ArtistPage';
import { useOnlineArtist } from '../hooks/useOnlineArtist';
import { useArtistImages } from '../hooks/useArtistImages';
import { useCoverThumbs } from '../hooks/useCoverThumbs';
import { useElementWidth } from '../hooks/useElementWidth';
import { LibraryControls } from './LibraryControls';

export type View = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'album-detail' | 'artist-detail' | 'genre-detail' | 'playlist-detail' | 'folder-detail';
export type LibraryViewMode = 'DEFAULT' | 'COMPACT' | 'TECHNICAL' | 'GRID';
// Re-exported so existing importers (App.tsx) keep their `from './LibraryView'`.
export type { LibrarySortMode };

interface LibraryViewProps {
  view: View;
  setView: (view: View) => void;
  libraryViewMode: LibraryViewMode;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  librarySortMode: LibrarySortMode;
  setLibrarySortMode: (mode: LibrarySortMode) => void;
  /** Content-rating filter (App-owned & persistent, like the sort mode). */
  ratingFilter: RatingFilter;
  setRatingFilter: (filter: RatingFilter) => void;
  showViewMenu: boolean;
  setShowViewMenu: (show: boolean) => void;
  selectedAlbum: string | null;
  setSelectedAlbum: (album: string) => void;
  selectedArtist: string | null;
  setSelectedArtist: (artist: string) => void;
  selectedGenre: string | null;
  setSelectedGenre: (genre: string) => void;
  selectedPlaylist: string | null;
  setSelectedPlaylist: (id: string) => void;
  selectedFolder: string | null;
  setSelectedFolder: (path: string) => void;
  offlinePaths?: Set<string>;
  onImport?: () => void;
  isMobile?: boolean;
  /**
   * Desktop pins. App owns the list (usePersistentState doesn't sync across
   * hook instances, so re-reading it here would be a second, divergent copy) —
   * these two are the whole interface the library needs.
   */
  isPinned?: (kind: 'album' | 'artist', key: string) => boolean;
  onTogglePin?: (kind: 'album' | 'artist', key: string) => void;
}

export function LibraryView({
  view, setView,
  libraryViewMode, setLibraryViewMode, librarySortMode, setLibrarySortMode, ratingFilter, setRatingFilter, showViewMenu, setShowViewMenu,
  selectedAlbum, setSelectedAlbum, selectedArtist, setSelectedArtist,
  selectedGenre, setSelectedGenre, selectedPlaylist, setSelectedPlaylist,
  selectedFolder, setSelectedFolder, offlinePaths,
  onImport, isMobile = false, isPinned, onTogglePin
}: LibraryViewProps) {
  // Player state (transport, playlists) comes from context; the view/selection/
  // sort UI state stays as props (it's App-owned, not player state).
  const {
    playlist, currentIndex, isPlaying, playTrack, removeTrack,
    userPlaylists, createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist, deletePlaylist,
    repeatMode, updateTrackDetails,
  } = usePlayer();
  const { t } = useI18n();

  // Cached artist photos for the artists browse grid. A read-only Map — the
  // grid never fetches; Settings > FETCH_ARTIST_PHOTOS fills the cache.
  const [onlineArtist] = useOnlineArtist();
  const artistImages = useArtistImages(onlineArtist);

  // Small persistent cover thumbnails (see services/thumbCache.ts) — the views
  // below draw these instead of the full-resolution covers. App.tsx warms the
  // cache shortly after launch, so by the time this window opens most thumbs
  // already exist; on-screen misses jump the queue via the hook.
  const thumbFor = useCoverThumbs();

  // Parent directory of a native file path (used by the folder-detail view).
  const parentDir = (p: string) => {
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return i > 0 ? p.slice(0, i) : p;
  };

  // A track is offline when its file is currently unreachable (drive removed).
  const isOffline = (track: Track) =>
    !!offlinePaths && !!track.nativePath && offlinePaths.has(track.nativePath.toLowerCase());
  const [showSortMenu, setShowSortMenu] = React.useState(false);
  const [showRatingMenu, setShowRatingMenu] = React.useState(false);

  // Cycle a track's advisory by hand: unmarked → explicit → clean → unmarked.
  // Persists through the player (updateTrackDetails → dbService), so the sign
  // and the filter agree next launch.
  const cycleRating = (track: Track) => {
    const next = track.explicit === undefined ? true : track.explicit === true ? false : undefined;
    updateTrackDetails(track.id, { explicit: next });
  };

  // How much room this panel actually has. The library lives in a draggable
  // window, so the screen size says nothing about it — measure the panel and
  // let the header controls grow when the window is maximized (or just wide)
  // and collapse back to icons when it isn't. 620px is roughly "wider than the
  // default 380px library window, with room for two labelled buttons".
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const roomy = !isMobile && rootWidth >= 620;


  const isRepeat = repeatMode !== 'none';

  // A single O(n) pass builds every grouping the views need: each track's library
  // index, and the tracks under each album/artist/genre. The render then does map
  // lookups instead of re-scanning the whole library once per group or per row —
  // that per-group `filter` and per-row `findIndex` were O(groups·n) / O(rows·n),
  // the main source of lag on a large library.
  const { indexById, tracksByAlbum, tracksByArtist, tracksByGenre } = React.useMemo(() => {
    const indexById = new Map<string, number>();
    const tracksByAlbum = new Map<string, Track[]>();
    const tracksByArtist = new Map<string, Track[]>();
    const tracksByGenre = new Map<string, Track[]>();
    const push = (m: Map<string, Track[]>, k: string, track: Track) => {
      const arr = m.get(k);
      if (arr) arr.push(track);
      else m.set(k, [track]);
    };
    playlist.forEach((track, i) => {
      indexById.set(track.id, i);
      push(tracksByAlbum, track.album, track);
      push(tracksByArtist, track.artist, track);
      push(tracksByGenre, track.genre || 'Unknown Genre', track);
    });
    return { indexById, tracksByAlbum, tracksByArtist, tracksByGenre };
  }, [playlist]);

  // Map insertion order is first-appearance order — the same order the old
  // `new Set(playlist.map(...))` produced, so DEFAULT sort is unchanged.
  const sortKeys = (keys: string[]) => {
    if (librarySortMode === 'A-Z') return [...keys].sort((a, b) => a.localeCompare(b));
    if (librarySortMode === 'Z-A') return [...keys].sort((a, b) => b.localeCompare(a));
    return keys;
  };
  const albums = React.useMemo(
    () => sortKeys([...tracksByAlbum.keys()]),
    [tracksByAlbum, librarySortMode]
  );
  const artists = React.useMemo(
    () => sortKeys([...tracksByArtist.keys()]),
    [tracksByArtist, librarySortMode]
  );
  const genres = React.useMemo(
    () => sortKeys([...tracksByGenre.keys()]),
    [tracksByGenre, librarySortMode]
  );

  const filteredTracks = React.useMemo(() => {
    let tracks = playlist;
    if (view === 'album-detail' && selectedAlbum) {
      tracks = playlist.filter(t => t.album === selectedAlbum);
    } else if (view === 'artist-detail' && selectedArtist) {
      tracks = playlist.filter(t => t.artist === selectedArtist);
    } else if (view === 'genre-detail' && selectedGenre) {
      tracks = playlist.filter(t => (t.genre || 'Unknown Genre') === selectedGenre);
    } else if (view === 'folder-detail' && selectedFolder) {
      tracks = playlist.filter(t => t.nativePath && parentDir(t.nativePath) === selectedFolder);
    } else if (view === 'playlist-detail' && selectedPlaylist) {
      const p = userPlaylists.find(pl => pl.id === selectedPlaylist);
      if (p) {
        tracks = playlist.filter(t => p.trackIds.includes(t.id));
      } else {
        tracks = [];
      }
    }
    
    return sortTracks(filterByRating(tracks, ratingFilter), librarySortMode);
  }, [playlist, view, selectedAlbum, selectedArtist, selectedGenre, selectedPlaylist, selectedFolder, userPlaylists, librarySortMode, ratingFilter]);

  const renderPlaylistHeader = () => {
    if (view === 'album-detail' || view === 'artist-detail' || view === 'genre-detail' || view === 'playlist-detail' || view === 'folder-detail') {
      let titleText = '';
      let backView: View = 'albums';
      if (view === 'album-detail') { titleText = selectedAlbum || ''; backView = 'albums'; }
      if (view === 'artist-detail') { titleText = selectedArtist || ''; backView = 'artists'; }
      if (view === 'genre-detail') { titleText = selectedGenre || ''; backView = 'genres'; }
      if (view === 'folder-detail') {
        const p = selectedFolder || '';
        const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
        titleText = (i >= 0 ? p.slice(i + 1) : p) || p;
        backView = 'songs';
      }
      if (view === 'playlist-detail') {
        const p = userPlaylists.find(pl => pl.id === selectedPlaylist);
        titleText = p ? p.name : '';
        backView = 'playlists';
      }

      // Pin the album to the desktop as a wirable icon. The artist page has its
      // own PIN button in its hero; this covers album-detail, whose header is
      // the only chrome it has.
      const pinnable = view === 'album-detail' && !!titleText && !!onTogglePin;
      const albumPinned = pinnable && !!isPinned?.('album', titleText);

      return (
        <div className="flex items-center justify-between mb-4 relative">
          <div className="flex items-center gap-4">
            <button onClick={() => setView(backView)} className="brutal-btn p-2">
              <ChevronLeft size={20} />
            </button>
            <h3 className={`text-2xl font-display uppercase text-brutal-white truncate ${roomy ? 'max-w-[420px]' : 'max-w-[150px]'}`}>
              {titleText}
            </h3>
            {pinnable && (
              <button
                onClick={() => onTogglePin?.('album', titleText)}
                title={albumPinned ? 'Remove this album from the desktop' : 'Pin this album to the desktop as a wirable icon'}
                className={`p-1 flex items-center justify-center border-2 transition-colors ${
                  albumPinned
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                {albumPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            )}
            {/* The artist page is one designed layout, not a browse list, so it
                ignores the view modes — hide the control there rather than
                leave a button that visibly does nothing. SORT still applies. */}
            <LibraryControls
              roomy={roomy}
              hideView={view === 'artist-detail'}
              libraryViewMode={libraryViewMode}
              setLibraryViewMode={setLibraryViewMode}
              librarySortMode={librarySortMode}
              setLibrarySortMode={setLibrarySortMode}
              ratingFilter={ratingFilter}
              setRatingFilter={setRatingFilter}
              showViewMenu={showViewMenu}
              setShowViewMenu={setShowViewMenu}
              showSortMenu={showSortMenu}
              setShowSortMenu={setShowSortMenu}
              showRatingMenu={showRatingMenu}
              setShowRatingMenu={setShowRatingMenu}
            />
          </div>
          <span className="font-mono text-[10px] bg-brutal-white text-brutal-black px-2 py-1">
            {filteredTracks.length} {t('u.tracks')}
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between mb-4 relative">
        <div className={`flex items-center ${roomy ? 'gap-4' : 'gap-2'}`}>
          <h3 className="text-3xl font-display uppercase text-brutal-white">
            {view === 'songs' ? t('lib.allSongs') : view === 'albums' ? t('lib.albums') : view === 'artists' ? t('lib.artists') : view === 'genres' ? t('lib.genres') : t('lib.playlists')}
          </h3>
          <LibraryControls
            roomy={roomy}
            libraryViewMode={libraryViewMode}
            setLibraryViewMode={setLibraryViewMode}
            librarySortMode={librarySortMode}
            setLibrarySortMode={setLibrarySortMode}
            ratingFilter={ratingFilter}
            setRatingFilter={setRatingFilter}
            showViewMenu={showViewMenu}
            setShowViewMenu={setShowViewMenu}
            showSortMenu={showSortMenu}
            setShowSortMenu={setShowSortMenu}
            showRatingMenu={showRatingMenu}
            setShowRatingMenu={setShowRatingMenu}
          />
        </div>
        <span className="font-mono text-xs bg-brutal-white text-brutal-black px-2 py-1">
          {view === 'songs' ? playlist.length : view === 'albums' ? albums.length : view === 'artists' ? artists.length : view === 'genres' ? genres.length : userPlaylists.length} {t('u.items')}
        </span>
      </div>
    );
  };

  const renderMainContent = () => {
    if (view === 'albums') {
      if (libraryViewMode === 'GRID') {
        return (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,calc(50%-8px)),1fr))] auto-rows-max gap-5 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
            {albums.map((album) => {
              const albumTracks = (tracksByAlbum.get(album) ?? []);
              const firstCover = thumbFor(albumTracks.find(t => t.coverUrl));
              return (
                <div
                  key={album}
                  onClick={() => {
                    setSelectedAlbum(album);
                    setView('album-detail');
                  }}
                  className="brutal-card p-0 cursor-pointer overflow-hidden border-2 aspect-square relative group border-brutal-white grid-tile transition-transform duration-150 hover:scale-105 hover:rotate-1"
                >
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-brutal-white/5">
                      <Disc size={32} className="opacity-20" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-brutal-black/80 p-2 border-t-2 border-brutal-white/20">
                    <p className="font-display text-[10px] uppercase truncate text-brutal-white group-hover:text-brutal-neon transition-colors">
                      {album}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div className="cv-list space-y-2 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
          {albums.map((album) => {
            const albumTracks = (tracksByAlbum.get(album) ?? []);
            const firstCover = thumbFor(albumTracks.find(t => t.coverUrl));

            if (libraryViewMode === 'COMPACT') {
              return (
                <div
                  key={album}
                  onClick={() => {
                    setSelectedAlbum(album);
                    setView('album-detail');
                  }}
                  className="px-3 py-1 cursor-pointer border-l-4 border-brutal-white/20 hover:border-brutal-neon hover:bg-brutal-white/5 transition-all flex items-center justify-between group"
                >
                  <p className="font-bold uppercase truncate text-sm flex-1">{album}</p>
                  <span className="font-mono text-[10px] opacity-40">{albumTracks.length} {t('u.trk')}</span>
                </div>
              );
            }

            if (libraryViewMode === 'TECHNICAL') {
              return (
                <div
                  key={album}
                  onClick={() => {
                    setSelectedAlbum(album);
                    setView('album-detail');
                  }}
                  className="p-2 cursor-pointer border-2 border-brutal-white/10 hover:border-brutal-neon hover:bg-brutal-white/5 font-mono text-[10px] transition-all group"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold truncate">{(album as string).toUpperCase()}</span>
                    <span className="opacity-60">{albumTracks.length} {t('u.tracks')}</span>
                  </div>
                  <div className="flex gap-3 opacity-40 group-hover:opacity-100 transition-opacity mt-1">
                    <span>{t('lbl.artist')}: {albumTracks[0]?.artist?.toUpperCase() || t('unknown')}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={album}
                onClick={() => {
                  setSelectedAlbum(album);
                  setView('album-detail');
                }}
                className="brutal-card p-3 cursor-pointer transition-all flex items-center gap-4 group hover:bg-brutal-white/5 hover:translate-x-[5px] border-brutal-white"
              >
                <div className="w-12 h-12 flex items-center justify-center border-2 border-brutal-white overflow-hidden flex-shrink-0">
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <Disc size={24} className="opacity-20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold uppercase truncate text-lg leading-tight group-hover:text-brutal-neon transition-colors">
                    {album}
                  </p>
                  <p className="font-mono text-[10px] uppercase opacity-60">
                    {albumTracks.length} {t('u.tracks')} // {albumTracks[0]?.artist}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (view === 'artists') {
      if (libraryViewMode === 'GRID') {
        return (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,calc(50%-8px)),1fr))] auto-rows-max gap-5 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
            {artists.map((artist) => {
              const artistTracks = (tracksByArtist.get(artist) ?? []);
              // A real artist photo if one is cached, else fall back to album art
              // from their tracks — the grid still looks right offline. Thumb
              // size on purpose: the full-size photo (~1000px) made the browse
              // grid fetch+decode one XL image per tile, which is the scroll lag.
              const firstCover =
                artistImages.get(artist) ?? thumbFor(artistTracks.find(t => t.coverUrl));
              return (
                <div
                  key={artist}
                  onClick={() => {
                    setSelectedArtist(artist);
                    setView('artist-detail');
                  }}
                  className="brutal-card p-0 cursor-pointer overflow-hidden border-2 aspect-square relative group border-brutal-white grid-tile transition-transform duration-150 hover:scale-105 hover:-rotate-1"
                >
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-brutal-white/5">
                      <User size={32} className="opacity-20" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-brutal-black/80 p-2 border-t-2 border-brutal-white/20">
                    <p className="font-display text-[10px] uppercase truncate text-brutal-white group-hover:text-brutal-neon transition-colors">
                      {artist}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div className="cv-list space-y-2 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
          {artists.map((artist) => {
            const artistTracks = (tracksByArtist.get(artist) ?? []);
            // Cached artist photo first, album art as the offline fallback.
            const firstCover =
              artistImages.get(artist) ?? thumbFor(artistTracks.find(t => t.coverUrl));

            if (libraryViewMode === 'COMPACT') {
              return (
                <div
                  key={artist}
                  onClick={() => {
                    setSelectedArtist(artist);
                    setView('artist-detail');
                  }}
                  className="px-3 py-1 cursor-pointer border-l-4 border-brutal-white/20 hover:border-brutal-neon hover:bg-brutal-white/5 transition-all flex items-center justify-between group"
                >
                  <p className="font-bold uppercase truncate text-sm flex-1">{artist}</p>
                  <span className="font-mono text-[10px] opacity-40">{artistTracks.length} {t('u.rel')}</span>
                </div>
              );
            }

            if (libraryViewMode === 'TECHNICAL') {
              return (
                <div
                  key={artist}
                  onClick={() => {
                    setSelectedArtist(artist);
                    setView('artist-detail');
                  }}
                  className="p-2 cursor-pointer border-2 border-brutal-white/10 hover:border-brutal-neon hover:bg-brutal-white/5 font-mono text-[10px] transition-all group"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold truncate">{(artist as string).toUpperCase()}</span>
                    <span className="opacity-60">{artistTracks.length} {t('u.releases')}</span>
                  </div>
                  <div className="flex gap-3 opacity-40 group-hover:opacity-100 transition-opacity mt-1">
                    <span>{t('u.albums')}: {Array.from(new Set(artistTracks.map(t => t.album))).length}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={artist}
                onClick={() => {
                  setSelectedArtist(artist);
                  setView('artist-detail');
                }}
                className="brutal-card p-3 cursor-pointer transition-all flex items-center gap-4 group hover:bg-brutal-white/5 hover:translate-x-[5px] border-brutal-white"
              >
                <div className="w-12 h-12 flex items-center justify-center border-2 border-brutal-white overflow-hidden flex-shrink-0">
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <User size={24} className="opacity-20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold uppercase truncate text-lg leading-tight group-hover:text-brutal-neon transition-colors">
                    {artist}
                  </p>
                  <p className="font-mono text-[10px] uppercase opacity-60">
                    {artistTracks.length} {t('u.releases')} // {Array.from(new Set(artistTracks.map(t => t.album))).length} {t('u.albums')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (view === 'genres') {
      if (libraryViewMode === 'GRID') {
        return (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,calc(50%-8px)),1fr))] auto-rows-max gap-5 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
            {genres.map((genre) => {
              const genreTracks = (tracksByGenre.get(genre) ?? []);
              const firstCover = thumbFor(genreTracks.find(t => t.coverUrl));
              return (
                <div
                  key={genre}
                  onClick={() => {
                    setSelectedGenre(genre);
                    setView('genre-detail');
                  }}
                  className="brutal-card p-0 cursor-pointer overflow-hidden border-2 aspect-square relative group border-brutal-white grid-tile transition-transform duration-150 hover:scale-105 hover:rotate-1"
                >
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-brutal-white/5">
                      <Bookmark size={32} className="opacity-20" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-brutal-black/80 p-2 border-t-2 border-brutal-white/20">
                    <p className="font-display text-[10px] uppercase truncate text-brutal-white group-hover:text-brutal-neon transition-colors">
                      {genre}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div className="cv-list space-y-2 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
          {genres.map((genre) => {
            const genreTracks = (tracksByGenre.get(genre) ?? []);
            const firstCover = thumbFor(genreTracks.find(t => t.coverUrl));

            if (libraryViewMode === 'COMPACT') {
              return (
                <div
                  key={genre}
                  onClick={() => {
                    setSelectedGenre(genre);
                    setView('genre-detail');
                  }}
                  className="px-3 py-1 cursor-pointer border-l-4 border-brutal-white/20 hover:border-brutal-neon hover:bg-brutal-white/5 transition-all flex items-center justify-between group"
                >
                  <p className="font-bold uppercase truncate text-sm flex-1">{genre}</p>
                  <span className="font-mono text-[10px] opacity-40">{genreTracks.length} {t('u.trk')}</span>
                </div>
              );
            }

            if (libraryViewMode === 'TECHNICAL') {
              return (
                <div
                  key={genre}
                  onClick={() => {
                    setSelectedGenre(genre);
                    setView('genre-detail');
                  }}
                  className="p-2 cursor-pointer border-2 border-brutal-white/10 hover:border-brutal-neon hover:bg-brutal-white/5 font-mono text-[10px] transition-all group"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold truncate">{(genre as string).toUpperCase()}</span>
                    <span className="opacity-60">{genreTracks.length} {t('u.tracks')}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={genre}
                onClick={() => {
                  setSelectedGenre(genre);
                  setView('genre-detail');
                }}
                className="brutal-card p-3 cursor-pointer transition-all flex items-center gap-4 group hover:bg-brutal-white/5 hover:translate-x-[5px] border-brutal-white"
              >
                <div className="w-12 h-12 flex items-center justify-center border-2 border-brutal-white overflow-hidden flex-shrink-0">
                  {firstCover ? (
                    <img src={firstCover} className="w-full h-full object-cover grayscale group-hover:grayscale-0" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <Bookmark size={24} className="opacity-20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold uppercase truncate text-lg leading-tight group-hover:text-brutal-neon transition-colors">
                    {genre}
                  </p>
                  <p className="font-mono text-[10px] uppercase opacity-60">
                    {genreTracks.length} {t('u.tracks')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (view === 'playlists') {
      return (
        <div className="space-y-4 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
          <div className="brutal-card p-4 border-brutal-white/20">
             <form onSubmit={async (e) => {
               e.preventDefault();
               const val = (e.target as any).elements.pname.value;
               if (val) {
                 await createPlaylist(val);
                 (e.target as any).reset();
               }
             }} className="flex gap-2">
               <input name="pname" type="text" placeholder={t('pl.newName')} className="brutal-input flex-1 text-xs" />
               <button type="submit" className="brutal-btn p-2"><Plus size={16} /></button>
             </form>
          </div>
          <div className="space-y-2">
            {userPlaylists.map(p => {
               return (
                 <div
                   key={p.id}
                   onClick={() => { setSelectedPlaylist(p.id); setView('playlist-detail'); }}
                   className="brutal-card p-3 cursor-pointer transition-all flex items-center justify-between group hover:bg-brutal-white/5 hover:translate-x-[5px] border-brutal-white"
                 >
                   <div className="flex items-center gap-4 flex-1">
                     <div className="w-12 h-12 flex items-center justify-center border-2 border-brutal-white overflow-hidden flex-shrink-0">
                       <List size={24} className="opacity-20" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="font-bold uppercase truncate text-lg leading-tight group-hover:text-brutal-neon transition-colors">
                         {p.name}
                       </p>
                       <p className="font-mono text-[10px] uppercase opacity-60">
                         {p.trackIds.length} {t('u.tracks')}
                       </p>
                     </div>
                   </div>
                   <button onClick={async (e) => { e.stopPropagation(); await deletePlaylist(p.id); }} className="p-2 opacity-0 group-hover:opacity-100 transition-opacity hover:text-brutal-neon">
                     <Trash2 size={16} />
                   </button>
                 </div>
               );
            })}
          </div>
        </div>
      );
    }

    // The artist page owns its whole layout — hero, stats, albums row, its own
    // tracks AND the features an exact-tag filter used to hide — so it renders
    // INSTEAD of the shared track list, not above it. Everything below is
    // untouched by it.
    if (view === 'artist-detail' && selectedArtist) {
      return (
        <ArtistPage
          artist={selectedArtist}
          tracks={playlist}
          librarySortMode={librarySortMode}
          onSelectAlbum={(album) => {
            setSelectedAlbum(album);
            setView('album-detail');
          }}
          isOffline={isOffline}
          pinned={!!isPinned?.('artist', selectedArtist)}
          onTogglePin={onTogglePin ? () => onTogglePin('artist', selectedArtist) : undefined}
        />
      );
    }

    if (view === 'songs' || view === 'album-detail' || view === 'genre-detail' || view === 'playlist-detail' || view === 'folder-detail') {
      if (libraryViewMode === 'GRID') {
        return (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(168px,calc(50%-8px)),1fr))] auto-rows-max gap-5 overflow-y-auto pr-2 h-full custom-scrollbar pb-4">
            {filteredTracks.map((track) => {
              const globalIndex = indexById.get(track.id) ?? -1;
              const offline = isOffline(track);
              const cover = thumbFor(track);
              return (
                <div
                  key={track.id}
                  onClick={() => playTrack(globalIndex, filteredTracks.map(t => t.id))}
                  className={`brutal-card p-0 cursor-pointer overflow-hidden border-2 aspect-square relative group grid-tile transition-transform duration-150 hover:scale-105 hover:rotate-1 ${offline ? 'opacity-40 ' : ''}${
                    currentIndex === globalIndex ? 'border-brutal-neon shadow-brutal-neon' : 'border-brutal-white'
                  }`}
                >
                  {offline && (
                    <span className="absolute top-1 right-1 z-10 bg-brutal-black border border-red-500 text-red-500 p-0.5" title="OFFLINE">
                      <Unplug size={12} />
                    </span>
                  )}
                  {track.explicit !== undefined && (
                    <RatingBadge track={track} className="absolute top-1 left-1 z-10" />
                  )}
                  {cover ? (
                    <img src={cover} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-brutal-white/5">
                      <Music size={32} className="opacity-20" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-brutal-black/80 p-2 border-t-2 border-brutal-white/20">
                    <p className="font-display text-[10px] uppercase truncate text-brutal-white group-hover:text-brutal-neon transition-colors">
                      {track.name}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return (
        <div className={`cv-list space-y-2 overflow-y-auto pr-2 h-full custom-scrollbar pb-4`}>
            {filteredTracks.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="brutal-card opacity-80 text-center py-16 flex flex-col items-center justify-center border-brutal-white/20"
              >
                <div className="w-20 h-20 border-4 border-dashed border-brutal-white/20 flex items-center justify-center mb-6">
                   <Plus className="text-brutal-white/20" size={40} />
                </div>
                <p className="font-display text-2xl uppercase tracking-tighter mb-2">{t('empty.title')}</p>
                <p className="font-mono text-[10px] text-brutal-white/40 uppercase mb-8">{t('empty.sub')}</p>
                <button
                  onClick={() => onImport?.()}
                  className="brutal-btn bg-brutal-neon text-brutal-black hover:bg-brutal-white"
                >
                  {t('empty.cta')}
                </button>
              </motion.div>
            ) : (
              filteredTracks.map((track) => {
                const globalIndex = indexById.get(track.id) ?? -1;
                const offline = isOffline(track);
                const cover = thumbFor(track);

                if (libraryViewMode === 'COMPACT') {
                  return (
                    <div
                      key={track.id}
                      onClick={() => playTrack(globalIndex, filteredTracks.map(t => t.id))}
                      className={`px-3 py-1 cursor-pointer border-l-4 transition-all flex items-center justify-between gap-2 group ${offline ? 'opacity-40 ' : ''}${
                        currentIndex === globalIndex
                          ? 'border-brutal-neon text-brutal-neon bg-brutal-white/5'
                          : 'border-brutal-white/20 hover:border-brutal-neon hover:bg-brutal-white/5'
                      }`}
                    >
                      <p className="font-bold uppercase truncate text-sm flex-1">
                        {track.name}
                      </p>
                      <RatingBadge track={track} />
                      {offline && <Unplug size={12} className="text-red-500 shrink-0" title="OFFLINE" />}
                      {currentIndex === globalIndex && isPlaying && (
                        <Zap size={12} className="animate-pulse" />
                      )}
                    </div>
                  );
                }

                if (libraryViewMode === 'TECHNICAL') {
                  return (
                    <div
                      key={track.id}
                      onClick={() => playTrack(globalIndex, filteredTracks.map(t => t.id))}
                      className={`p-2 cursor-pointer border-2 font-mono text-[10px] transition-all group ${offline ? 'opacity-40 ' : ''}${
                        currentIndex === globalIndex
                          ? 'border-brutal-neon text-brutal-neon bg-brutal-white/5'
                          : 'border-brutal-white/10 hover:border-brutal-neon hover:bg-brutal-white/5'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="flex items-center gap-1.5 min-w-0 max-w-[70%]">
                          <span className="font-bold truncate">{track.name.toUpperCase()}</span>
                          <RatingBadge track={track} />
                        </span>
                        <span className="opacity-60">{formatTime(track.duration || 0)}</span>
                      </div>
                      <div className="flex gap-3 opacity-40 group-hover:opacity-100 transition-opacity">
                        <span>{track.codec || 'UNK'}</span>
                        <span>{track.bitrate ? `${Math.round(track.bitrate / 1000)}K` : '---'}</span>
                        <span>{track.sampleRate ? `${track.sampleRate}HZ` : '---'}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={track.id}
                    onClick={() => playTrack(globalIndex, filteredTracks.map(t => t.id))}
                    className={`brutal-card p-4 cursor-pointer transition-all flex items-center gap-4 group ${offline ? 'opacity-50 ' : ''}${
                      currentIndex === globalIndex ? 'border-brutal-neon text-brutal-neon bg-brutal-white/5 shadow-[8px_8px_0px_0px_var(--brutal-neon)]' : 'hover:bg-brutal-white/5 border-brutal-white'
                    }`}
                  >
                    <div className={`w-10 h-10 flex items-center justify-center font-display text-xl border-2 overflow-hidden flex-shrink-0 ${
                      currentIndex === globalIndex ? 'border-brutal-neon text-brutal-neon' : 'border-brutal-white'
                    }`}>
                      {cover ? (
                        <img src={cover} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                      ) : currentIndex === globalIndex && isPlaying ? (
                        <div className="flex items-end gap-[2px] h-4">
                          <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.5 }} className="w-1 bg-current" />
                          <motion.div animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 0.4 }} className="w-1 bg-current" />
                          <motion.div animate={{ height: [4, 10, 4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1 bg-current" />
                        </div>
                      ) : (
                        (globalIndex + 1).toString().padStart(2, '0')
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold uppercase truncate text-lg leading-tight flex items-center gap-2">
                        <span className="truncate">{track.name}</span>
                        <RatingBadge track={track} />
                      </p>
                      <p className={`font-mono text-[10px] uppercase opacity-60`}>
                        {track.artist} // {track.album}
                      </p>
                    </div>
                    {offline && (
                      <span className="flex items-center gap-1 font-mono text-[9px] uppercase text-red-500 border border-red-500 px-1.5 py-0.5 shrink-0" title="File offline — drive not connected">
                        <Unplug size={12} /> OFFLINE
                      </span>
                    )}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); cycleRating(track); }}
                        className={`p-2 border-2 transition-colors ${
                          isExplicit(track)
                            ? 'border-brutal-white bg-brutal-white text-brutal-black'
                            : 'border-brutal-white/20 hover:border-brutal-neon'
                        }`}
                        title={t('tip.markRating')}
                      >
                        <ShieldAlert size={16} />
                      </button>
                      {userPlaylists.length > 0 && (
                        <select 
                          className="bg-brutal-black border-2 border-brutal-white text-brutal-white font-mono text-[10px] p-1 w-24 outline-none focus:border-brutal-neon"
                          onChange={(e) => { e.stopPropagation(); e.target.value && addTrackToPlaylist(e.target.value, track.id); e.target.value = ""; }}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">{t('pl.add')}</option>
                          {userPlaylists.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      {view === 'playlist-detail' ? (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedPlaylist) removeTrackFromPlaylist(selectedPlaylist, track.id);
                          }}
                          className="p-2 hover:bg-brutal-neon hover:text-brutal-black transition-colors"
                          title={t('tip.removeFromPlaylist')}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTrack(track.id);
                          }}
                          className="p-2 hover:bg-brutal-neon hover:text-brutal-black transition-colors"
                          title={t('tip.deleteTrack')}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <Volume2 size={16} />
                    </div>
                  </div>
                );
              })
            )}
        </div>
      );
    }

    return null;
  };

  const navPadding = isMobile ? 'py-3' : 'py-2';
  const navIconSize = isMobile ? 18 : 14;
  const navTextSize = isMobile ? 'text-[10px]' : 'text-[8px]';

  return (
    <div ref={rootRef} className={isMobile ? "brutal-card p-4 h-[500px] lg:h-[750px] flex flex-col" : "flex flex-col h-full p-4"}>
      <nav className={"flex gap-3 md:gap-4 pb-3 pr-3 overflow-x-auto custom-scrollbar " + (isMobile ? "mb-4" : "mb-4")}>
        <button onClick={() => setView('songs')} className={`brutal-btn w-[100px] flex-shrink-0 flex flex-col items-center justify-center ${navPadding} gap-1 ${view === 'songs' || view === 'album-detail' || view === 'artist-detail' || view === 'genre-detail' || view === 'playlist-detail' || view === 'folder-detail' ? 'bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black' : ''}`}>
          <ListMusic size={navIconSize} />
          <span className={`${navTextSize} font-bold`}>{t('lib.songs')}</span>
        </button>
        <button onClick={() => setView('albums')} className={`brutal-btn w-[100px] flex-shrink-0 flex flex-col items-center justify-center ${navPadding} gap-1 ${view === 'albums' ? 'bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black' : ''}`}>
          <Disc size={navIconSize} />
          <span className={`${navTextSize} font-bold`}>{t('lib.albums')}</span>
        </button>
        <button onClick={() => setView('artists')} className={`brutal-btn w-[100px] flex-shrink-0 flex flex-col items-center justify-center ${navPadding} gap-1 ${view === 'artists' ? 'bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black' : ''}`}>
          <User size={navIconSize} />
          <span className={`${navTextSize} font-bold`}>{t('lib.artists')}</span>
        </button>
        <button onClick={() => setView('genres')} className={`brutal-btn w-[100px] flex-shrink-0 flex flex-col items-center justify-center ${navPadding} gap-1 ${view === 'genres' ? 'bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black' : ''}`}>
          <Bookmark size={navIconSize} />
          <span className={`${navTextSize} font-bold`}>{t('lib.genres')}</span>
        </button>
        <button onClick={() => setView('playlists')} className={`brutal-btn w-[100px] flex-shrink-0 flex flex-col items-center justify-center ${navPadding} gap-1 ${view === 'playlists' ? 'bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black' : ''}`}>
          <List size={navIconSize} />
          <span className={`${navTextSize} font-bold`}>{t('lib.playlists')}</span>
        </button>
      </nav>
      {renderPlaylistHeader()}
      <div className="flex-1 overflow-hidden">
        {renderMainContent()}
      </div>
    </div>
  );
}
