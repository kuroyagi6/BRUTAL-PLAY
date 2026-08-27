// Pure color-contrast helper. The accent (--brutal-accent) can be anything —
// the default soviet red, a manual accent, or a color extracted from album art —
// so anything drawn ON the accent (the active now-playing widget) needs a
// foreground picked from the accent's luminance, not a hard-coded black/white.

/** Parse '#rgb', '#rrggbb', or 'rgb()/rgba()' into [r,g,b] 0-255, or null. */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim();
  const hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((x) => parseFloat(x));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Black or white — whichever reads better on `color`. Threshold 0.4 (not 0.5)
 * biases toward white, which matches how mid-tone brand colors (the red accent)
 * actually look: black text on them is the hard-to-read case.
 */
export function readableOn(color: string): '#000000' | '#FFFFFF' {
  return luminance(color) > 0.4 ? '#000000' : '#FFFFFF';
}
