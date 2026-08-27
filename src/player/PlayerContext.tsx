import React from 'react';
import type { useAudioPlayer } from '../hooks/useAudioPlayer';

/**
 * The full playback API (transport, queue, EQ/FX, volume, playlists, wires) as
 * returned by useAudioPlayer. Provided once at the app root so player-driven
 * windows read what they need via `usePlayer()` instead of receiving 15-20
 * drilled props each. App still holds the object for its own logic and for the
 * views that also mix in App-level UI state (Library, Settings).
 */
export type PlayerApi = ReturnType<typeof useAudioPlayer>;

const PlayerContext = React.createContext<PlayerApi | null>(null);

export function PlayerProvider({ value, children }: { value: PlayerApi; children: React.ReactNode }) {
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = React.useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
}
