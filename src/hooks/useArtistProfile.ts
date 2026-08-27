// Lazily resolves an online artist profile for a name and caches it in IndexedDB.
// Contained on purpose: it composes the pure resolver (services/artistProfile)
// with the IPC transport and the profile cache, and touches nothing in the audio
// engine or useAudioPlayer's return shape. The UI (ArtistPage) is the only
// consumer. Off unless `enabled` — looking a name up sends it to a third party,
// so the caller gates it behind a Settings opt-in.
import { useEffect, useState, useCallback, useRef } from 'react';
import type { ArtistProfile } from '../types';
import { resolveArtistProfile, PROFILE_VERSION, type JsonGetter } from '../services/artistProfile';
import { getArtistProfile, saveArtistProfile } from '../services/dbService';

const UNKNOWN = new Set(['', 'unknown artist', 'various artists']);

/** The IPC-backed JSON getter; undefined outside Electron (browser preview). */
function bridgeGetter(): JsonGetter | undefined {
  const api = (window as any).electronAPI;
  return api?.httpGetJson ? (url: string) => api.httpGetJson(url) : undefined;
}

export interface UseArtistProfile {
  profile: ArtistProfile | null;
  loading: boolean;
  /** 'offline' when Electron/network is unavailable, else a message, else null. */
  error: string | null;
  /** Whether the lookup found nothing (distinct from an error). */
  notFound: boolean;
  /** Force a fresh lookup, bypassing the cache. */
  refetch: () => void;
}

export function useArtistProfile(artistName: string | undefined, enabled: boolean): UseArtistProfile {
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refetch() to re-run the effect and skip the cache read.
  const [nonce, setNonce] = useState(0);
  const forceRef = useRef(false);

  const name = (artistName || '').trim();
  const key = name.toLowerCase();
  const skip = !enabled || UNKNOWN.has(key);

  useEffect(() => {
    if (skip) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const force = forceRef.current;
    forceRef.current = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!force) {
          const cached = await getArtistProfile(key);
          // A row written by an older resolver is a MISS, not an answer: it was
          // cached before the photo source existed, so trusting it would mean
          // "no picture" forever for every artist looked up on an old build.
          if (cached && (cached.v ?? 1) >= PROFILE_VERSION) {
            if (!cancelled) {
              setProfile(cached);
              setLoading(false);
            }
            return;
          }
        }

        const get = bridgeGetter();
        if (!get) {
          // Browser preview / no Electron bridge — nothing to fetch through.
          if (!cancelled) {
            setError('offline');
            setProfile(null);
            setLoading(false);
          }
          return;
        }

        const resolved = await resolveArtistProfile(name, get);
        await saveArtistProfile(resolved);
        if (!cancelled) {
          setProfile(resolved);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'lookup failed');
          setProfile(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // key drives identity; nonce forces a bypass-cache refetch.
  }, [key, name, skip, nonce]);

  const refetch = useCallback(() => {
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  return {
    profile,
    loading,
    error,
    notFound: !!profile?.notFound,
    refetch,
  };
}
