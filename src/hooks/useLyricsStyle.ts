// How the lyrics are DRAWN — font, size, alignment, dim, glow. Persisted, and
// broadcast on a custom event so a popped-out LYRICS window repaints the moment
// the STYLE tab changes something (usePersistentState alone is per-window).
//
// Sizes and spacing come out as inline styles, not Tailwind classes: Tailwind
// only ships classes it can see in the source, so a computed `text-[27px]` would
// silently render as nothing.
import React, { useCallback, useEffect, useState } from 'react';

export type LyricsFont = 'display' | 'mono' | 'sans';
export type LyricsAlign = 'left' | 'center' | 'right';
export type LyricsBg = 'none' | 'dim' | 'solid';

export interface LyricsStyle {
  font: LyricsFont;
  /** Active-line font size in px; passed lines scale off this. */
  size: number;
  align: LyricsAlign;
  /** Force uppercase, the way the rest of the app shouts. */
  upper: boolean;
  /** Vertical gap between lines, in px. */
  spacing: number;
  /** Opacity (0-100) of lines that aren't the active one. */
  dim: number;
  /** Accent-colour the active line (vs plain white). */
  accent: boolean;
  /** Neon glow behind the active line. */
  glow: boolean;
  /** Blur every line except the active one. */
  focus: boolean;
  /** Show the track title/artist header above the lyrics. */
  header: boolean;
  bg: LyricsBg;
}

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  font: 'display',
  size: 30,
  align: 'center',
  upper: false,
  spacing: 24,
  dim: 40,
  accent: true,
  glow: false,
  focus: false,
  header: true,
  bg: 'none',
};

export const LYRICS_STYLE_KEY = 'brutal-lyricsStyle';
const EVENT = `${LYRICS_STYLE_KEY}-changed`;

export const SIZE_RANGE = { min: 14, max: 64 };
export const SPACING_RANGE = { min: 4, max: 64 };

/** Unknown/legacy keys are dropped and missing ones defaulted, so a stale blob
 *  in localStorage can never render an unstyled window. */
export function coerceStyle(raw: any): LyricsStyle {
  const s = { ...DEFAULT_LYRICS_STYLE };
  if (!raw || typeof raw !== 'object') return s;
  const num = (v: any, min: number, max: number, fallback: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const oneOf = <T,>(v: any, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v) ? v : fallback;

  s.font = oneOf(raw.font, ['display', 'mono', 'sans'] as const, s.font);
  s.size = num(raw.size, SIZE_RANGE.min, SIZE_RANGE.max, s.size);
  s.align = oneOf(raw.align, ['left', 'center', 'right'] as const, s.align);
  s.upper = typeof raw.upper === 'boolean' ? raw.upper : s.upper;
  s.spacing = num(raw.spacing, SPACING_RANGE.min, SPACING_RANGE.max, s.spacing);
  s.dim = num(raw.dim, 0, 100, s.dim);
  s.accent = typeof raw.accent === 'boolean' ? raw.accent : s.accent;
  s.glow = typeof raw.glow === 'boolean' ? raw.glow : s.glow;
  s.focus = typeof raw.focus === 'boolean' ? raw.focus : s.focus;
  s.header = typeof raw.header === 'boolean' ? raw.header : s.header;
  s.bg = oneOf(raw.bg, ['none', 'dim', 'solid'] as const, s.bg);
  return s;
}

function read(): LyricsStyle {
  try {
    const raw = localStorage.getItem(LYRICS_STYLE_KEY);
    return coerceStyle(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_LYRICS_STYLE };
  }
}

export interface UseLyricsStyle {
  style: LyricsStyle;
  set: (patch: Partial<LyricsStyle>) => void;
  reset: () => void;
}

export function useLyricsStyle(): UseLyricsStyle {
  const [style, setStyle] = useState<LyricsStyle>(read);

  useEffect(() => {
    const sync = () => setStyle(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // other windows
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const write = useCallback((next: LyricsStyle) => {
    try {
      localStorage.setItem(LYRICS_STYLE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota/denied */
    }
    setStyle(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const set = useCallback(
    (patch: Partial<LyricsStyle>) => write(coerceStyle({ ...read(), ...patch })),
    [write]
  );

  const reset = useCallback(() => write({ ...DEFAULT_LYRICS_STYLE }), [write]);

  return { style, set, reset };
}

// ─── Pure style → CSS mapping (kept out of the components so both the live view
//     and the STYLE tab's preview render from exactly the same rules) ──────────

export const FONT_CLASS: Record<LyricsFont, string> = {
  display: 'font-display tracking-tight',
  mono: 'font-mono tracking-tighter',
  sans: 'font-sans',
};

export const ALIGN_CLASS: Record<LyricsAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export const BG_CLASS: Record<LyricsBg, string> = {
  none: '',
  dim: 'bg-brutal-black/60',
  solid: 'bg-brutal-black',
};

export type LineState = 'active' | 'passed' | 'upcoming';

/** Inline style for one lyric line in a given state. */
export function lineStyle(s: LyricsStyle, state: LineState): React.CSSProperties {
  const active = state === 'active';
  return {
    fontSize: active ? s.size : Math.max(12, Math.round(s.size * 0.62)),
    marginBottom: s.spacing,
    opacity: active ? 1 : s.dim / 100,
    filter: !active && s.focus ? 'blur(2px)' : undefined,
    textTransform: s.upper ? 'uppercase' : undefined,
    transition: 'font-size .25s, opacity .25s, filter .25s, color .25s',
    // The glow reads as a halo on the active line only; var(--brutal-neon) is
    // the same accent the rest of the app themes off.
    textShadow: active && s.glow ? '0 0 18px var(--accent, #d4ff00)' : undefined,
  };
}

/** Class list for one lyric line in a given state. */
export function lineClass(s: LyricsStyle, state: LineState): string {
  const active = state === 'active';
  return [
    FONT_CLASS[s.font],
    ALIGN_CLASS[s.align],
    active ? (s.accent ? 'text-brutal-neon font-bold' : 'text-brutal-white font-bold') : 'text-brutal-white',
    'leading-tight',
  ].join(' ');
}
