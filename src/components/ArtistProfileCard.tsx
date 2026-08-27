import React from 'react';
import { RefreshCw, Globe, ExternalLink, WifiOff } from 'lucide-react';
import type { ArtistProfile } from '../types';

// The online artist profile (photo + bio + tags + attribution) and every state
// it can be in: opted out, loading, offline, failed, not found, loaded.
//
// ArtistPage ('hero') is its only caller today: the compact 'panel' variant was
// the Inspector's ARTIST tab, which followed the PLAYING track, and went with
// that window. The variant is kept because it costs nothing and is what any
// future now-playing artist panel should render through — the two surfaces
// answered different questions but must never drift apart visually.
// Presentational on purpose: the caller owns the lookup hook, so this stays free
// of the cache and the transport.

export interface ArtistProfileCardProps {
  profile: ArtistProfile | null;
  loading: boolean;
  /** 'offline' when there's no Electron bridge, else a message, else null. */
  error: string | null;
  notFound: boolean;
  /** Whether the online-profile opt-in is on. */
  enabled: boolean;
  /** Turn the opt-in on from the gate. */
  onEnable: () => void;
  refetch?: () => void;
  /** False when there's no real artist tag to look up. */
  known?: boolean;
  variant?: 'panel' | 'hero';
}

export const ArtistProfileCard: React.FC<ArtistProfileCardProps> = ({
  profile,
  loading,
  error,
  notFound,
  enabled,
  onEnable,
  refetch,
  known = true,
  variant = 'panel',
}) => {
  const hero = variant === 'hero';

  if (!enabled) {
    return (
      <div className="p-4 border-2 border-dashed border-brutal-white/20">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={16} className="text-brutal-neon" />
          <p className="text-xs uppercase font-mono">ONLINE_ARTIST_PROFILES</p>
        </div>
        <p className="text-[10px] font-mono text-brutal-white/50 uppercase leading-relaxed mb-3">
          FETCH_PHOTO_FROM_DEEZER_+_BIO_FROM_MUSICBRAINZ/WIKIPEDIA. THE_ARTIST_NAME_IS_SENT_TO_THOSE_SERVICES.
        </p>
        <button
          onClick={onEnable}
          className="w-full p-3 border-2 border-brutal-white/20 hover:border-brutal-neon flex items-center justify-center gap-2 text-xs font-mono uppercase transition-colors"
        >
          <Globe size={14} />
          ENABLE_ONLINE_LOOKUP
        </button>
      </div>
    );
  }

  if (!known) {
    return (
      <p className="text-[10px] font-mono text-brutal-white/40 uppercase p-3 border-2 border-dashed border-brutal-white/20">
        NO_ARTIST_TAG_TO_LOOK_UP
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-brutal-white/50 text-xs font-mono uppercase p-3">
        <RefreshCw size={14} className="animate-spin" />
        LOOKING_UP…
      </div>
    );
  }

  if (error === 'offline') {
    return (
      <div className="p-3 border-2 border-brutal-white/20 flex items-center gap-2 text-brutal-white/50 text-[10px] font-mono uppercase">
        <WifiOff size={14} />
        ONLINE_LOOKUP_UNAVAILABLE_HERE
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 border-2 border-red-600/40 text-red-500 text-[10px] font-mono uppercase">
        LOOKUP_FAILED // {error}
        {refetch && (
          <button onClick={refetch} className="block mt-2 underline">
            RETRY
          </button>
        )}
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <p className="text-[10px] font-mono text-brutal-white/40 uppercase p-3 border-2 border-dashed border-brutal-white/20">
        NO_PROFILE_FOUND_FOR_THIS_ARTIST
      </p>
    );
  }

  return (
    <div className={hero ? 'flex flex-col md:flex-row gap-5' : ''}>
      {profile.imageUrl && (
        <img
          src={profile.imageUrl}
          alt={profile.name}
          className={
            hero
              ? 'w-full md:w-56 h-56 object-cover border-4 border-brutal-white shrink-0'
              : 'w-full max-h-56 object-cover border-4 border-brutal-white mb-3'
          }
          referrerPolicy="no-referrer"
          loading="lazy"
          // Remote image; if it 404s, hide it rather than show a broken icon.
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}

      <div className="min-w-0 flex-1 font-mono">
        {profile.disambiguation && (
          <p className="text-[10px] text-brutal-neon uppercase mb-2">{profile.disambiguation}</p>
        )}

        {profile.tags && profile.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {profile.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] uppercase px-2 py-1 border-2 border-brutal-white/20 tracking-wide"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {profile.bio && (
          <p
            className={`text-xs text-brutal-white/80 leading-relaxed mb-4 whitespace-pre-line ${
              // The hero sits above a track list, so a long bio would push the
              // music off-screen; the panel has room to run.
              hero ? 'line-clamp-6' : ''
            }`}
          >
            {profile.bio}
          </p>
        )}

        {profile.country && (
          <p className="text-[10px] text-brutal-white/40 uppercase mb-3">ORIGIN // {profile.country}</p>
        )}

        {/* Attribution links (required by the sources). */}
        {profile.sources.length > 0 && (
          <div className="pt-3 border-t-2 border-brutal-white/10">
            <p className="text-[9px] text-brutal-white/30 uppercase mb-2 tracking-widest">SOURCES</p>
            <div className="flex flex-wrap gap-2">
              {profile.sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] uppercase px-2 py-1 border-2 border-brutal-white/20 hover:border-brutal-neon flex items-center gap-1 transition-colors"
                >
                  {s.label}
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
