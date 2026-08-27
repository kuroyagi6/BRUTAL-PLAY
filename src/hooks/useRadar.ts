// RADAR: scans the library's artists against Deezer and reports tracks by those
// artists that the library appears to lack, plus adjacent artists with nothing
// in the library at all.
//
// Contained on purpose, like useArtistProfile before it: it composes the pure
// resolver (services/recommend) with the IPC transport and a localStorage cache,
// and touches nothing in the audio engine or the player's return shape. The UI
// (RadarView, DesktopWidgets) is the only consumer.
//
// OFF unless `enabled`: a scan sends every scanned artist name to Deezer, which
// is the user's call to make — same bargain as the artist-photo lookup.
//
// A scan is EXPLICIT. It never runs on mount, on import, or on a timer: it is
// dozens of requests and it is only ever useful when someone is looking at the
// result. The cached report is what the widgets read between scans.
import React from 'react';
import type { Track } from '../types';
import { makeFlagHook } from './useLocalFlag';
import {
  scanArtist,
  collateScans,
  scanCandidates,
  RADAR_VERSION,
  type ArtistScan,
  type JsonGetter,
  type RelatedArtist,
  type SuggestedTrack,
} from '../services/recommend';

/** The opt-in that gates every RADAR request. Default OFF. */
export const useOnlineRadar = makeFlagHook('brutal-onlineRadar');

const REPORT_KEY = 'brutal-radar-report';
const DISMISSED_KEY = 'brutal-radar-dismissed';

/** How many artists one scan covers. */
export const SCAN_LIMIT = 40;

/**
 * Seconds one artist costs. iTunes allows ~20 calls/minute and RADAR sends it
 * one request per artist, so the 3.1s throttle in httpGet.cjs — not the network
 * — sets the pace. The Deezer half adds ~0.25s. Used only to show an estimate,
 * because a two-minute scan with no ETA reads as a hang.
 */
export const SECONDS_PER_ARTIST = 3.4;

/** Rough wall-clock estimate for scanning `n` artists, as "2 MIN" / "45 SEC". */
export function scanEta(n: number): string {
  const secs = Math.round(n * SECONDS_PER_ARTIST);
  return secs < 90 ? `${secs} SEC` : `${Math.round(secs / 60)} MIN`;
}

export interface RadarReport {
  v: number;
  /** When the scan finished (epoch ms). */
  at: number;
  /** How many artists were scanned. */
  scanned: number;
  /** Artists Deezer had no exact match for — reported, not an error. */
  notFound: string[];
  tracks: SuggestedTrack[];
  artists: RelatedArtist[];
}

export interface ScanProgress {
  done: number;
  total: number;
  /** The artist currently being looked up. */
  current: string;
}

export interface UseRadar {
  report: RadarReport | null;
  scanning: boolean;
  progress: ScanProgress | null;
  /** 'offline' when the Electron bridge is missing, else a message, else null. */
  error: string | null;
  scan: () => void;
  cancel: () => void;
  /** Hide one suggestion for good. */
  dismiss: (id: string) => void;
  dismissed: Set<string>;
  /** Un-hide everything and drop the cached report. */
  reset: () => void;
  /** The report minus dismissed rows — what the UI should render. */
  visible: { tracks: SuggestedTrack[]; artists: RelatedArtist[] };
}

/** The IPC-backed JSON getter; undefined outside Electron (browser preview). */
function bridgeGetter(): JsonGetter | undefined {
  const api = (window as any).electronAPI;
  return api?.httpGetJson ? (url: string) => api.httpGetJson(url) : undefined;
}

function readReport(): RadarReport | null {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RadarReport;
    // A report written by an older format is a MISS, not an answer.
    return parsed && parsed.v === RADAR_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useRadar(tracks: Track[], enabled: boolean): UseRadar {
  const [report, setReport] = React.useState<RadarReport | null>(readReport);
  const [scanning, setScanning] = React.useState(false);
  const [progress, setProgress] = React.useState<ScanProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<Set<string>>(readDismissed);

  // Set by cancel() and read between artists, so a 40-artist scan stops within
  // one request instead of running to completion in the background.
  const cancelled = React.useRef(false);
  // The library, read at scan time rather than closed over, so a scan started
  // before an import finishes still diffs against the finished library.
  const tracksRef = React.useRef(tracks);
  tracksRef.current = tracks;

  const scan = React.useCallback(() => {
    if (!enabled) return;
    const get = bridgeGetter();
    if (!get) {
      setError('offline');
      return;
    }

    const candidates = scanCandidates(tracksRef.current, SCAN_LIMIT);
    if (candidates.length === 0) {
      setError('no artists in the library to scan');
      return;
    }

    cancelled.current = false;
    setScanning(true);
    setError(null);
    setProgress({ done: 0, total: candidates.length, current: candidates[0] });

    (async () => {
      const scans: ArtistScan[] = [];
      const notFound: string[] = [];
      // How many artists were actually reached — a cancelled scan still saves
      // what it found, and the report must not claim it covered the rest.
      let attempted = 0;
      try {
        for (let i = 0; i < candidates.length; i++) {
          if (cancelled.current) break;
          const artist = candidates[i];
          attempted++;
          setProgress({ done: i, total: candidates.length, current: artist });
          try {
            const s = await scanArtist(artist, tracksRef.current, get);
            // Always collected: a scan that found tracks but no neighbours (or
            // the reverse) still carries rows worth showing. notFound is only a
            // report line, never a reason to discard the result.
            scans.push(s);
            if (s.notFound) notFound.push(artist);
          } catch {
            // One artist failing (a 403, a timeout, a name Deezer chokes on)
            // must not lose the other 39 results. Skip and keep going; a total
            // outage still surfaces as an empty report the user can re-run.
            notFound.push(artist);
          }
        }

        const { tracks: outTracks, artists: outArtists } = collateScans(scans, tracksRef.current);
        const next: RadarReport = {
          v: RADAR_VERSION,
          at: Date.now(),
          scanned: attempted,
          notFound,
          tracks: outTracks,
          artists: outArtists,
        };
        setReport(next);
        try {
          localStorage.setItem(REPORT_KEY, JSON.stringify(next));
        } catch {
          /* quota — the in-memory report still works for this session */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'scan failed');
      } finally {
        setScanning(false);
        setProgress(null);
      }
    })();
  }, [enabled]);

  const cancel = React.useCallback(() => {
    cancelled.current = true;
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const reset = React.useCallback(() => {
    cancelled.current = true;
    setReport(null);
    setDismissed(new Set());
    setError(null);
    try {
      localStorage.removeItem(REPORT_KEY);
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const visible = React.useMemo(
    () => ({
      tracks: (report?.tracks ?? []).filter((t) => !dismissed.has(t.id)),
      artists: (report?.artists ?? []).filter((a) => !dismissed.has(`artist:${a.id}`)),
    }),
    [report, dismissed]
  );

  return { report, scanning, progress, error, scan, cancel, dismiss, dismissed, reset, visible };
}
