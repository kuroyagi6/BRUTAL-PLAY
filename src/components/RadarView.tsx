import React from 'react';
import { Radar, ExternalLink, X, Music, User, Search, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import type { SuggestedTrack, RelatedArtist } from '../services/recommend';
import { youtubeSearchUrl } from '../services/recommend';
import type { UseRadar } from '../hooks/useRadar';
import { SCAN_LIMIT, scanEta } from '../hooks/useRadar';
import { formatTime } from '../utils/format';

// RADAR — what your artists released that you don't have, and who sits next to
// them. Presentation only: the scan, the cache and the library diff all live in
// useRadar / services/recommend. This file decides how a suggestion looks and
// where its links point, nothing else.
//
// Every row links OUT. The app never acquires audio — it points at the track's
// Deezer page and a YouTube search and lets the user decide, the same call the
// YouTube layer made when it chose to embed rather than rip.
//
// Row components live at MODULE scope. Declaring a component inside another
// component's body re-creates its type every render, which makes React discard
// and rebuild every row — the artist page's track list used to flicker for
// exactly that reason. Don't move these inside RadarView.

const SectionHead: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <p className="font-mono text-[9px] uppercase tracking-widest text-brutal-neon/70 mb-2">
    {label} // {count}
  </p>
);

const LinkBtn: React.FC<{ href: string; title: string; children: React.ReactNode }> = ({
  href,
  title,
  children,
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    title={title}
    onClick={(e: React.MouseEvent) => e.stopPropagation()}
    className="p-1.5 border-2 border-brutal-white/20 hover:border-brutal-neon text-brutal-white/70 hover:text-brutal-neon transition-colors shrink-0"
  >
    {children}
  </a>
);

const TrackSuggestion: React.FC<{ track: SuggestedTrack; onDismiss: (id: string) => void }> =
  React.memo(({ track, onDismiss }: { track: SuggestedTrack; onDismiss: (id: string) => void }) => (
    <div className="brutal-card p-3 flex items-center gap-3 border-brutal-white group">
      <div className="w-10 h-10 flex items-center justify-center border-2 border-brutal-white overflow-hidden shrink-0">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Music size={18} className="opacity-20" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold uppercase truncate text-sm leading-tight">{track.title}</p>
        <p className="font-mono text-[10px] uppercase opacity-50 truncate">
          {track.artist}
          {track.album ? ` // ${track.album}` : ''}
        </p>
      </div>

      {track.duration ? (
        <span className="font-mono text-[10px] opacity-40 shrink-0 tabular-nums hidden sm:inline">
          {formatTime(track.duration)}
        </span>
      ) : null}

      {track.link && (
        <LinkBtn href={track.link} title="Open on Deezer">
          <ExternalLink size={13} />
        </LinkBtn>
      )}
      <LinkBtn href={youtubeSearchUrl(track)} title="Search YouTube for this track">
        <Search size={13} />
      </LinkBtn>
      <button
        onClick={() => onDismiss(track.id)}
        title="Hide this suggestion"
        className="p-1.5 border-2 border-brutal-white/20 hover:border-red-500 text-brutal-white/40 hover:text-red-500 transition-colors shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  ));

const ArtistSuggestion: React.FC<{ artist: RelatedArtist; onDismiss: (id: string) => void }> =
  React.memo(({ artist, onDismiss }: { artist: RelatedArtist; onDismiss: (id: string) => void }) => (
    <div className="brutal-card p-3 flex items-center gap-3 border-brutal-white group">
      <div className="w-10 h-10 flex items-center justify-center border-2 border-brutal-white overflow-hidden shrink-0">
        {artist.thumbUrl ? (
          <img
            src={artist.thumbUrl}
            alt=""
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <User size={18} className="opacity-20" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold uppercase truncate text-sm leading-tight">{artist.name}</p>
        <p className="font-mono text-[10px] uppercase opacity-50 truncate">
          BECAUSE YOU HAVE {artist.via}
        </p>
      </div>

      <span className="font-mono text-[9px] opacity-40 shrink-0 tabular-nums hidden sm:inline">
        {artist.fans.toLocaleString()} FANS
      </span>

      {artist.link && (
        <LinkBtn href={artist.link} title="Open on Deezer">
          <ExternalLink size={13} />
        </LinkBtn>
      )}
      <button
        onClick={() => onDismiss(`artist:${artist.id}`)}
        title="Hide this artist"
        className="p-1.5 border-2 border-brutal-white/20 hover:border-red-500 text-brutal-white/40 hover:text-red-500 transition-colors shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  ));

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="font-mono text-[10px] uppercase text-brutal-white/40 p-3 border-2 border-dashed border-brutal-white/20">
    {children}
  </p>
);

interface RadarViewProps {
  radar: UseRadar;
  enabled: boolean;
  onEnable: () => void;
  /** How many artists the library offers — shown before the first scan. */
  artistCount: number;
}

export const RadarView: React.FC<RadarViewProps> = ({
  radar,
  enabled,
  onEnable,
  artistCount,
}: RadarViewProps) => {
  const { report, scanning, progress, error, scan, cancel, dismiss, reset, visible } = radar;

  // The opt-in gate. Nothing here has touched the network yet.
  if (!enabled) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar p-1">
        <div className="border-2 border-brutal-white/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-brutal-neon">
            <Radar size={18} />
            <p className="font-display text-lg uppercase tracking-tighter">RADAR_IS_OFF</p>
          </div>
          <p className="font-mono text-[10px] uppercase leading-relaxed text-brutal-white/60">
            RADAR compares your artists against the iTunes and Deezer catalogues and lists the
            tracks you don't have. Turning it on sends the ARTIST NAMES in your library to those
            two services — nothing else, no files and no listening history.
          </p>
          <p className="font-mono text-[10px] uppercase leading-relaxed text-brutal-white/40">
            It only ever suggests and links out. It does not download anything.
          </p>
          <button
            onClick={onEnable}
            className="brutal-btn bg-brutal-neon text-brutal-black border-brutal-black flex items-center gap-2 text-xs"
          >
            <Radar size={14} /> ENABLE_RADAR
          </button>
        </div>
      </div>
    );
  }

  const scannedAt = report ? new Date(report.at) : null;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar pr-2 pb-4 space-y-5">
      {/* CONTROL BAR */}
      <div className="flex items-center gap-3 flex-wrap">
        {scanning ? (
          <button onClick={cancel} className="brutal-btn flex items-center gap-2 text-xs">
            <Loader2 size={14} className="animate-spin" /> CANCEL_SCAN
          </button>
        ) : (
          <button
            onClick={scan}
            className="brutal-btn bg-brutal-neon text-brutal-black border-brutal-black flex items-center gap-2 text-xs"
          >
            <Radar size={14} /> {report ? 'RESCAN' : 'SCAN_LIBRARY'}
          </button>
        )}
        {report && !scanning && (
          <button
            onClick={reset}
            title="Clear the report and un-hide everything"
            className="brutal-btn flex items-center gap-2 text-xs"
          >
            <RefreshCw size={14} /> CLEAR
          </button>
        )}
        {scannedAt && !scanning && (
          <span className="font-mono text-[9px] uppercase text-brutal-white/40">
            LAST_SCAN // {scannedAt.toLocaleDateString()} {scannedAt.toLocaleTimeString()} //{' '}
            {report?.scanned} ARTISTS
          </span>
        )}
      </div>

      {/* PROGRESS */}
      {scanning && progress && (
        <div className="border-2 border-brutal-white/10 p-3 space-y-2">
          <div className="flex justify-between font-mono text-[9px] uppercase">
            <span className="truncate text-brutal-neon">SCANNING // {progress.current}</span>
            <span className="opacity-50 shrink-0 tabular-nums">
              {progress.done} / {progress.total} // ~{scanEta(progress.total - progress.done)} LEFT
            </span>
          </div>
          <div className="h-1.5 bg-brutal-white/10">
            <div
              className="h-full bg-brutal-neon transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* ERRORS */}
      {error === 'offline' ? (
        <div className="border-2 border-red-500/40 p-3 flex items-start gap-2">
          <WifiOff size={14} className="text-red-500 shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] uppercase leading-relaxed text-brutal-white/60">
            NO_NETWORK_BRIDGE — RADAR needs the desktop app to reach Deezer.
          </p>
        </div>
      ) : error ? (
        <div className="border-2 border-red-500/40 p-3">
          <p className="font-mono text-[10px] uppercase text-red-500">{error}</p>
        </div>
      ) : null}

      {/* FIRST RUN */}
      {!report && !scanning && !error && (
        <Empty>
          NOTHING_SCANNED_YET — SCAN_LIBRARY checks your top{' '}
          {Math.min(artistCount, SCAN_LIMIT)} artists. TAKES ~
          {scanEta(Math.min(artistCount, SCAN_LIMIT))} (rate-limited); you can cancel and the
          result is cached.
        </Empty>
      )}

      {/* MISSING TRACKS */}
      {report && (
        <div>
          <SectionHead label="MISSING TRACKS" count={visible.tracks.length} />
          {visible.tracks.length === 0 ? (
            <Empty>NOTHING_MISSING — your library covers what Deezer lists for these artists.</Empty>
          ) : (
            <div className="space-y-2">
              {visible.tracks.map((t) => (
                <TrackSuggestion key={t.id} track={t} onDismiss={dismiss} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* NEW ARTISTS */}
      {report && (
        <div>
          <SectionHead label="NEW ARTISTS" count={visible.artists.length} />
          {visible.artists.length === 0 ? (
            <Empty>NO_NEW_ARTISTS</Empty>
          ) : (
            <div className="space-y-2">
              {visible.artists.map((a) => (
                <ArtistSuggestion key={a.id} artist={a} onDismiss={dismiss} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* NOT FOUND — reported so an absent artist reads as "the catalogues don't
          have them", not as a broken scan. */}
      {report && report.notFound.length > 0 && (
        <div>
          <SectionHead label="NOT FOUND" count={report.notFound.length} />
          <p className="font-mono text-[9px] uppercase text-brutal-white/30 leading-relaxed">
            {report.notFound.join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
};
