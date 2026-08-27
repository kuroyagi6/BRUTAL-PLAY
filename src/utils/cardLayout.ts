// Pure text layout for the lyrics card export. Canvas has no line wrapping and
// no "shrink to fit", so both are done here — as plain functions over an
// INJECTED measure callback, which keeps them testable with no canvas at all
// (see cardLayout.test.ts) and keeps the component down to drawing.

/** Measures a string at a given font size, in px. Canvas supplies the real one. */
export type Measure = (text: string, fontSize: number) => number;

/** Greedy word wrap. A word longer than the line is left overflowing on its own
 *  line rather than broken mid-word — `fitFontSize` shrinks until it fits. */
export function wrapText(text: string, fontSize: number, maxWidth: number, measure: Measure): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, fontSize) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface FitOptions {
  maxWidth: number;
  maxHeight: number;
  /** Multiple of font size used as line height. */
  lineHeight: number;
  min: number;
  max: number;
  measure: Measure;
  /** px step between tried sizes. 2 is imperceptible and halves the work. */
  step?: number;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  /** Total drawn height, so the caller can centre the block. */
  height: number;
  /** True when even the minimum size overflows — the caller should clip. */
  overflow: boolean;
}

/** Wrap every paragraph at one size, keeping blank entries as blank lines —
 *  they are the gaps between verses, and dropping them would reflow the quote. */
function layout(paragraphs: string[], size: number, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const p of paragraphs) {
    if (!p.trim()) {
      lines.push('');
      continue;
    }
    lines.push(...wrapText(p, size, maxWidth, measure));
  }
  return lines;
}

/**
 * Largest font size at which the whole quote fits the box, wrapped.
 *
 * Walks DOWN from `max`: the first size that fits is the answer, and starting
 * big means a short quote gets the poster-sized treatment instead of being
 * uniformly small.
 */
export function fitFontSize(paragraphs: string[], o: FitOptions): FitResult {
  const step = o.step ?? 2;

  for (let size = o.max; size >= o.min; size -= step) {
    const lines = layout(paragraphs, size, o.maxWidth, o.measure);
    const height = lines.length * size * o.lineHeight;
    // Width has to be re-checked, not assumed: wrapText leaves a single word
    // that's wider than the line intact rather than breaking it mid-word, so a
    // long unbroken lyric only comes inside the card by shrinking.
    const fitsWidth = lines.every((l) => o.measure(l, size) <= o.maxWidth);
    if (height <= o.maxHeight && fitsWidth) return { fontSize: size, lines, height, overflow: false };
  }

  // Nothing fits: lay out at the minimum and let the caller decide (it clips).
  const lines = layout(paragraphs, o.min, o.maxWidth, o.measure);
  return {
    fontSize: o.min,
    lines,
    height: lines.length * o.min * o.lineHeight,
    overflow: true,
  };
}

/** Card aspect ratios offered by the export panel. */
export interface CardSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CARD_SIZES: CardSize[] = [
  { id: 'square', label: '1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: '4:5', width: 1080, height: 1350 },
  { id: 'story', label: '9:16', width: 1080, height: 1920 },
];

/** Characters Windows refuses in a filename. Spaces and hyphens are NOT here —
 *  stripping those ran the words together. */
const ILLEGAL = /[<>:"/\\|?*]/g;

/** Control characters, matched by code point so no control byte ever appears in
 *  this source file. */
const isPrintable = (ch: string) => ch.charCodeAt(0) > 31;

/**
 * A filename Windows will accept: no reserved or control characters, and no
 * trailing dot or space (Explorer rejects both, silently).
 */
export function cardFileName(artist: string, track: string, sizeId: string): string {
  const clean = (s: string) =>
    Array.from(s || '')
      .filter(isPrintable)
      .join('')
      .replace(ILLEGAL, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
      .replace(/[. ]+$/, '') || 'untitled';
  return `${clean(artist)} - ${clean(track)} (${sizeId}).png`;
}
