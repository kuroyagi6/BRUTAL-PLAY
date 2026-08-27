// A read-only, in-memory index of cached artist photos: name -> image URL.
//
// Exists because Spotlight renders an avatar per result WHILE THE USER TYPES.
// It must never fetch on a keystroke (that would fire a request per character
// and get us rate-limited), so it reads the profile cache once, keeps a Map, and
// refreshes only when a write announces itself. A miss just means the icon —
// filling the cache is the prefetch's job (see useArtistPrefetch).
import { useEffect, useMemo, useState } from 'react';
import type { ArtistProfile } from '../types';
import { getAllArtistProfiles, ARTIST_PROFILES_CHANGED } from '../services/dbService';
import { normalizeArtist, splitArtists } from '../utils/artistCredits';

export interface ArtistImageIndex {
  /** Best cached photo for an artist tag, or undefined. `thumb` for list rows. */
  get: (artistTag: string | undefined, thumb?: boolean) => string | undefined;
  /** How many cached profiles carry a photo — drives the Settings counter. */
  withPhotos: number;
  /** Total cached profiles, including misses. */
  total: number;
}

export function useArtistImages(enabled: boolean): ArtistImageIndex {
  const [profiles, setProfiles] = useState<ArtistProfile[]>([]);

  useEffect(() => {
    if (!enabled) {
      setProfiles([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const all = await getAllArtistProfiles();
        if (!cancelled) setProfiles(all);
      } catch {
        /* cache unreadable — rows just show icons. */
      }
    };
    load();
    window.addEventListener(ARTIST_PROFILES_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(ARTIST_PROFILES_CHANGED, load);
    };
  }, [enabled]);

  return useMemo(() => {
    // Indexed under BOTH the raw cache key and a normalized form, so a tag of
    // "Jay Z" still finds a profile cached as "JAY-Z".
    const byKey = new Map<string, ArtistProfile>();
    let withPhotos = 0;
    for (const p of profiles) {
      if (p.imageUrl || p.thumbUrl) withPhotos++;
      byKey.set(p.key, p);
      const n = normalizeArtist(p.name || p.key);
      if (n && !byKey.has(n)) byKey.set(n, p);
    }

    const lookup = (name: string): ArtistProfile | undefined =>
      byKey.get(name.trim().toLowerCase()) ?? byKey.get(normalizeArtist(name));

    const get = (artistTag: string | undefined, thumb = true): string | undefined => {
      if (!artistTag) return undefined;
      // A multi-artist tag has no photo of its own — show the primary credit's
      // face, which is what a listener means by "the artist" on a feat. track.
      const direct = lookup(artistTag);
      const hit = direct ?? (() => {
        const [primary] = splitArtists(artistTag);
        return primary && primary !== artistTag ? lookup(primary) : undefined;
      })();
      if (!hit) return undefined;
      return thumb ? hit.thumbUrl || hit.imageUrl : hit.imageUrl || hit.thumbUrl;
    };

    return { get, withPhotos, total: profiles.length };
  }, [profiles]);
}
