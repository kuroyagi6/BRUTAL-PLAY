import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Music, Disc, User, Bookmark, List, Folder, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Track, Playlist } from '../types';
import type { View } from './LibraryView';
import { matchFieldsPrepared, prepareQuery } from '../utils/fuzzy';
import { useOnlineArtist } from '../hooks/useOnlineArtist';
import { useArtistImages } from '../hooks/useArtistImages';

interface SpotlightSearchProps {
  playlist: Track[];
  userPlaylists: Playlist[];
  importedFolders: { path: string; count: number; offline?: boolean }[];
  playTrack: (index: number, orderedIds?: string[]) => void;
  setSelectedAlbum: (album: string | null) => void;
  setSelectedArtist: (artist: string | null) => void;
  setSelectedGenre: (genre: string | null) => void;
  setSelectedFolder: (path: string | null) => void;
  setSelectedPlaylist: (id: string | null) => void;
  setView: (view: View) => void;
  openWindow: (id: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  /**
   * Float the trigger over the desktop as a centred pill (like the taskbar)
   * instead of taking a full-width row above it. Requires a `relative` ancestor.
   * Off for the mobile layout, where the bar sits in normal flow.
   */
  floating?: boolean;
}

const basename = (p: string) => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  const name = i >= 0 ? p.slice(i + 1) : p;
  return name || p;
};

type ResultType = 'song' | 'album' | 'artist' | 'genre' | 'playlist' | 'folder';

interface Result {
  id: string;
  type: ResultType;
  score: number;
  /** Which field the query hit — rendered as the "MATCH:" badge. */
  reason: string;
  title: string;
  titleHits: number[];
  subtitle: string;
  subtitleHits: number[];
  icon: React.ReactNode;
  coverUrl?: string;
  action: () => void;
}

type ResultWithIndex = Result & { flatIndex: number };

const CATEGORY: Record<ResultType, string> = {
  song: 'Tracks',
  album: 'Albums',
  artist: 'Artists',
  genre: 'Genres',
  playlist: 'Playlists',
  folder: 'Folders',
};

/** Per-type cap so one category can never crowd the others out. */
const LIMIT: Record<ResultType, number> = {
  song: 6,
  album: 4,
  artist: 4,
  genre: 3,
  playlist: 4,
  folder: 4,
};

/**
 * Renders `text` with only the characters the user actually typed at full
 * strength; everything else fades back. That is what makes it obvious *why* a
 * result is in the list.
 */
const Highlight: React.FC<{ text: string; hits: number[] }> = ({ text, hits }) => {
  const set = useMemo(() => new Set(hits), [hits]);
  if (hits.length === 0) return <>{text}</>;
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-brutal-neon font-black">
            {ch}
          </span>
        ) : (
          <span key={i} className="text-brutal-white/30">
            {ch}
          </span>
        )
      )}
    </>
  );
};

/**
 * The 32px square on a result row: album art, an artist photo, or the type icon.
 * Owns its own failure state because artist photos are REMOTE — a dead CDN URL
 * must fall back to the icon rather than leave a broken-image box.
 */
const ResultAvatar: React.FC<{ src?: string; icon: React.ReactNode }> = ({ src, icon }) => {
  const [failed, setFailed] = useState(false);
  // A recycled row can get a new src; forget the previous one's failure.
  useEffect(() => setFailed(false), [src]);
  return (
    <div className="w-8 h-8 flex items-center justify-center border border-brutal-white/12 text-brutal-white/50 shrink-0 overflow-hidden">
      {src && !failed ? (
        <img
          src={src}
          className="w-full h-full object-cover"
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        icon
      )}
    </div>
  );
};

export const SpotlightSearch: React.FC<SpotlightSearchProps> = ({
  playlist,
  userPlaylists,
  importedFolders,
  playTrack,
  setSelectedAlbum,
  setSelectedArtist,
  setSelectedGenre,
  setSelectedFolder,
  setSelectedPlaylist,
  setView,
  openWindow,
  isOpen,
  setIsOpen,
  floating = false,
}) => {
  const [searchVal, setSearchVal] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Artist avatars come from the cached-profile index — a Map read once, never a
  // fetch. Searching must not make network calls on every keystroke, so a cache
  // miss simply renders the icon; Settings > FETCH_ARTIST_PHOTOS fills it.
  const [onlineArtist] = useOnlineArtist();
  const artistImages = useArtistImages(onlineArtist);

  // The dropdown replaces the old full-screen backdrop, so it has to dismiss
  // itself on any click that lands outside the widget.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [isOpen, setIsOpen]);

  // Reset states on open/close
  useEffect(() => {
    if (isOpen) {
      setSearchVal('');
      setActiveIndex(0);
      // Timeout to ensure modal has mounted and is visible before focusing
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const query = useMemo(() => searchVal.trim(), [searchVal]);

  /**
   * Everything derived from the library that does NOT depend on the query,
   * computed once per library change instead of once per keystroke.
   *
   * This is the search-latency fix. The scan below runs on every keypress and
   * calls into the matcher 4x per track; previously each of those calls
   * re-parsed the query and allocated a fresh `toLowerCase()` of the field
   * (~20k throwaway strings per keystroke on a 5k-track library), and the
   * category lists re-walked the whole library three more times to find
   * distinct values plus a `playlist.find` per album and per artist result.
   * None of that varies while the user types, so all of it lives here now.
   */
  const index = useMemo(() => {
    const ids: string[] = [];
    const indexById = new Map<string, number>();
    // Lowercased once per track. Parallel to `playlist` by position.
    const lowered = playlist.map((t, i) => {
      ids.push(t.id);
      indexById.set(t.id, i);
      return {
        name: t.name.toLowerCase(),
        artist: t.artist.toLowerCase(),
        album: t.album.toLowerCase(),
        genre: (t.genre ?? '').toLowerCase(),
      };
    });

    // One pass builds every distinct-value list AND its cover, replacing three
    // Set passes plus a linear `find` per rendered result.
    const albums = new Map<string, string | undefined>();
    const artists = new Map<string, string | undefined>();
    const genres = new Set<string>();
    for (const t of playlist) {
      if (t.album?.trim()) {
        if (!albums.get(t.album)) albums.set(t.album, t.coverUrl);
      }
      if (t.artist?.trim()) {
        if (!artists.get(t.artist)) artists.set(t.artist, t.coverUrl);
      }
      if (t.genre?.trim()) genres.add(t.genre);
    }

    return { ids, indexById, lowered, albums, artists, genres: Array.from(genres) };
  }, [playlist]);

  const filteredItems = useMemo<Result[]>(() => {
    const pq = prepareQuery(query);
    if (!pq) return [];

    const songResults: Result[] = [];
    for (let i = 0; i < playlist.length; i++) {
      const t = playlist[i];
      const low = index.lowered[i];
      const m = matchFieldsPrepared(pq, [
        { key: 'name', value: t.name, weight: 1, lower: low.name },
        { key: 'artist', value: t.artist, weight: 0.85, lower: low.artist },
        { key: 'album', value: t.album, weight: 0.8, lower: low.album },
        { key: 'genre', value: t.genre ?? '', weight: 0.55, lower: low.genre },
      ]);
      if (!m) continue;

      const subtitle = `${t.artist} // ${t.album}`;
      // The subtitle is "artist // album", so an album hit sits at a fixed offset.
      const subtitleHits =
        m.key === 'artist'
          ? m.indices
          : m.key === 'album'
          ? m.indices.map((i) => i + t.artist.length + 4)
          : [];

      songResults.push({
        id: `song-${t.id}`,
        type: 'song',
        score: m.score,
        reason: m.key,
        title: t.name,
        titleHits: m.key === 'name' ? m.indices : [],
        subtitle,
        subtitleHits,
        icon: <Music size={16} />,
        coverUrl: t.coverUrl,
        action: () => playTrack(i, index.ids),
      });
    }

    /**
     * `coverFor` is what puts a picture on a non-song row. Without it these
     * results could only ever render their type icon, however much art or how
     * many artist photos were cached — the field was simply never filled.
     */
    const simple = (
      values: Iterable<string>,
      type: ResultType,
      subtitle: string,
      icon: React.ReactNode,
      onPick: (value: string) => void,
      coverFor?: (value: string) => string | undefined
    ): Result[] => {
      const out: Result[] = [];
      for (const value of values) {
        const m = matchFieldsPrepared(pq, [{ key: type, value, weight: 1 }]);
        if (!m) continue;
        out.push({
          id: `${type}-${value}`,
          type,
          score: m.score,
          reason: type,
          title: value,
          titleHits: m.indices,
          subtitle,
          subtitleHits: [],
          icon,
          coverUrl: coverFor?.(value),
          action: () => onPick(value),
        });
      }
      return out;
    };

    const albumResults = simple(
      index.albums.keys(),
      'album',
      'Album',
      <Disc size={16} />,
      (album) => {
        setSelectedAlbum(album);
        setView('album-detail');
        openWindow('library');
      },
      // The album's own art: the first cover found among its tracks, resolved
      // when the index was built.
      (album) => index.albums.get(album)
    );

    const artistResults = simple(
      index.artists.keys(),
      'artist',
      'Artist',
      <User size={16} />,
      (artist) => {
        setSelectedArtist(artist);
        setView('artist-detail');
        openWindow('library');
      },
      // Cached photo (Deezer/Wikipedia) first; fall back to a cover from one of
      // their tracks so the row still shows something recognisable offline.
      (artist) => artistImages.get(artist) ?? index.artists.get(artist)
    );

    const genreResults = simple(
      index.genres,
      'genre',
      'Genre',
      <Bookmark size={16} />,
      (genre) => {
        setSelectedGenre(genre);
        setView('genre-detail');
        openWindow('library');
      }
    );

    const folderResults: Result[] = importedFolders.flatMap((f) => {
      const name = basename(f.path);
      // Match the folder name first; the full path is a weaker, last-resort hit.
      const m = matchFieldsPrepared(pq, [
        { key: 'folder', value: name, weight: 1 },
        { key: 'path', value: f.path, weight: 0.5 },
      ]);
      if (!m) return [];
      return [
        {
          id: `folder-${f.path}`,
          type: 'folder' as const,
          score: m.score,
          reason: m.key,
          title: name,
          titleHits: m.key === 'folder' ? m.indices : [],
          subtitle: f.path,
          subtitleHits: m.key === 'path' ? m.indices : [],
          icon: <Folder size={16} />,
          action: () => {
            setSelectedFolder(f.path);
            setView('folder-detail');
            openWindow('library');
          },
        },
      ];
    });

    const playlistResults: Result[] = userPlaylists.flatMap((p) => {
      const m = matchFieldsPrepared(pq, [{ key: 'playlist', value: p.name, weight: 1 }]);
      if (!m) return [];
      return [
        {
          id: `playlist-${p.id}`,
          type: 'playlist' as const,
          score: m.score,
          reason: 'playlist',
          title: p.name,
          titleHits: m.indices,
          subtitle: `${p.trackIds.length} tracks`,
          subtitleHits: [],
          icon: <List size={16} />,
          action: () => {
            setSelectedPlaylist(p.id);
            setView('playlist-detail');
            openWindow('library');
          },
        },
      ];
    });

    // Rank inside each category, then cap it. Categories are ordered by their own
    // best hit, so an exact artist match outranks six loose track matches instead
    // of tracks always monopolising the top of the list.
    const byScore = (a: Result, b: Result) => b.score - a.score;
    const groups = [songResults, albumResults, artistResults, genreResults, playlistResults, folderResults]
      .filter((g) => g.length > 0)
      .map((g) => g.sort(byScore).slice(0, LIMIT[g[0].type]))
      .sort((a, b) => b[0].score - a[0].score);

    return groups.flat();
    // artistImages is memoized on the cached-profile snapshot, so results
    // re-render (and avatars appear) as the prefetch fills the cache in.
  }, [query, playlist, index, userPlaylists, importedFolders, playTrack, setSelectedAlbum, setSelectedArtist, setSelectedGenre, setSelectedFolder, setSelectedPlaylist, setView, openWindow, artistImages]);

  // Keep selected item visible when navigating with arrow keys
  useEffect(() => {
    if (resultsContainerRef.current) {
      const activeEl = resultsContainerRef.current.querySelector(
        `[data-search-index="${activeIndex}"]`
      ) as HTMLElement;
      if (activeEl) {
        const container = resultsContainerRef.current;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const elemTop = activeEl.offsetTop;
        const elemBottom = elemTop + activeEl.clientHeight;

        if (elemTop < containerTop) {
          container.scrollTop = elemTop;
        } else if (elemBottom > containerBottom) {
          container.scrollTop = elemBottom - container.clientHeight;
        }
      }
    }
  }, [activeIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) =>
          filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) =>
          filteredItems.length > 0
            ? (prev - 1 + filteredItems.length) % filteredItems.length
            : 0
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[activeIndex]) {
          filteredItems[activeIndex].action();
          setIsOpen(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, activeIndex, setIsOpen]);

  // Group items by type for nice category presentation. `filteredItems` is
  // already grouped and ranked, so insertion order preserves that ranking.
  const groupedResults = useMemo<[string, ResultWithIndex[]][]>(() => {
    const groups: Record<string, ResultWithIndex[]> = {};
    filteredItems.forEach((item, index) => {
      const label = CATEGORY[item.type];
      if (!groups[label]) groups[label] = [];
      groups[label].push({ ...item, flatIndex: index });
    });
    return Object.entries(groups);
  }, [filteredItems]);

  // Closed, the widget must sit *behind* windows (they start at z-index 1 and
  // climb to 10+ when focused) but above the wallpaper. Open, its dropdown has
  // to clear them — 9998 keeps it under the taskbar (9999) and menus (10000).
  const wrapper = floating
    ? `absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none transition-[width] duration-200 ${
        isOpen ? 'z-[9998] w-[min(640px,calc(100%-2rem))]' : 'z-0 w-[min(520px,calc(100%-2rem))]'
      }`
    : 'w-full relative';

  return (
    <div ref={rootRef} className={wrapper}>
      <div className="relative pointer-events-auto">
        {/* Collapsed pill — click to expand into the live search field. */}
        {!isOpen ? (
          <div
            onClick={() => setIsOpen(true)}
            className="p-3 border-2 border-brutal-white/25 bg-brutal-black/60 backdrop-blur-xl hover:border-brutal-neon/60 hover:bg-brutal-black/75 cursor-pointer flex items-center justify-between gap-3 group transition-colors select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Search className="text-brutal-white/60 group-hover:text-brutal-neon transition-colors shrink-0" size={18} />
              <span className="font-mono text-xs uppercase tracking-wide text-brutal-white/45 group-hover:text-brutal-white/70 transition-colors truncate">
                {floating ? 'SPOTLIGHT SEARCH' : 'SPOTLIGHT SEARCH (SONGS, ALBUMS, ARTISTS, GENRES...)'}
              </span>
            </div>
            <kbd className="hidden sm:inline-block shrink-0 font-mono text-[9px] text-brutal-white/40 border border-brutal-white/20 px-1.5 py-0.5 uppercase">
              Ctrl + K
            </kbd>
          </div>
        ) : (
          <div className="p-3 border-2 border-brutal-neon/70 bg-brutal-black/75 backdrop-blur-xl flex items-center gap-3">
            <Search className="text-brutal-neon shrink-0" size={18} />
            <input
              ref={inputRef}
              type="text"
              value={searchVal}
              onChange={(e) => {
                setSearchVal(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="SEARCH TRACKS, ALBUMS, ARTISTS, FOLDERS..."
              className="flex-1 min-w-0 bg-transparent border-none text-brutal-white font-mono text-sm uppercase outline-none placeholder:text-brutal-white/25 select-text"
            />
            {searchVal && (
              <button
                onClick={() => {
                  setSearchVal('');
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                className="shrink-0 text-brutal-white/40 hover:text-brutal-neon transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}

        {/* Results drop down from the widget itself — no full-screen takeover. */}
        <AnimatePresence>
          {isOpen && query && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              className="absolute left-0 right-0 top-full mt-2 border-2 border-brutal-white/15 bg-brutal-black/75 backdrop-blur-2xl overflow-hidden"
            >
              <div ref={resultsContainerRef} className="overflow-y-auto custom-scrollbar p-2 max-h-[46vh]">
                {filteredItems.length === 0 ? (
                  <p className="font-mono text-[10px] text-brutal-white/40 uppercase text-center py-8">
                    No matches for “{query}”
                  </p>
                ) : (
                  <div className="space-y-3">
                    {groupedResults.map(([category, typedItems]) => (
                      <div key={category}>
                        <h4 className="font-mono text-[9px] tracking-[0.2em] text-brutal-neon/70 uppercase px-2 pb-1.5">
                          {category}
                        </h4>
                        <div>
                          {typedItems.map((item) => {
                            const isSelected = activeIndex === item.flatIndex;
                            return (
                              <div
                                key={item.id}
                                data-search-index={item.flatIndex}
                                onMouseEnter={() => setActiveIndex(item.flatIndex)}
                                onClick={() => {
                                  item.action();
                                  setIsOpen(false);
                                }}
                                className={`flex items-center gap-3 px-2 py-1.5 cursor-pointer border-l-2 transition-colors ${
                                  isSelected ? 'bg-brutal-neon/12 border-brutal-neon' : 'border-transparent hover:bg-brutal-white/5'
                                }`}
                              >
                                <ResultAvatar src={item.coverUrl} icon={item.icon} />

                                <div className="flex-1 min-w-0">
                                  <p className="font-bold uppercase truncate text-xs text-brutal-white">
                                    <Highlight text={item.title} hits={item.titleHits} />
                                  </p>
                                  {item.subtitle && (
                                    <p className="font-mono text-[9px] uppercase truncate text-brutal-white/35">
                                      <Highlight text={item.subtitle} hits={item.subtitleHits} />
                                    </p>
                                  )}
                                </div>

                                {/* Why this result matched */}
                                <span className="hidden sm:inline-block font-mono text-[8px] uppercase tracking-widest text-brutal-white/30 shrink-0">
                                  {item.reason}
                                </span>

                                {isSelected && (
                                  <span className="font-mono text-[10px] text-brutal-neon shrink-0">↵</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
