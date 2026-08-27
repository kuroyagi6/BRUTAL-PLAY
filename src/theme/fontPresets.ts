// Font presets for the in-app typeface picker. Pure data — no React/DOM — so it
// can't interfere with anything; App applies the chosen preset by overriding the
// --font-display / --font-sans CSS vars at runtime.
//
// IMPORTANT: every `display` stack ends in a Cyrillic-capable fallback
// ("Rubik Mono One" / "Rubik"). Some display faces (e.g. Anton, Oswald) have no
// Cyrillic glyphs, so the Cyrillic UI labels fall back to Rubik instead of tofu.
// All fonts are self-hosted (fonts.css / fonts-extra.css) for offline use.

export interface FontPreset {
  id: string;
  /** Shown in the picker. */
  label: string;
  /** Applied to --font-display (headings, window titles, buttons). */
  display: string;
  /** Applied to --font-sans (body text). */
  sans: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'constructivist',
    label: 'КОНСТРУКТИВИЗМ',
    display: '"Rubik Mono One", sans-serif',
    sans: '"Rubik", sans-serif',
  },
  {
    id: 'soviet',
    label: 'СОВЕТСКИЙ',
    display: '"Russo One", "Rubik Mono One", sans-serif',
    sans: '"PT Sans", "Rubik", sans-serif',
  },
  {
    id: 'poster',
    label: 'ПЛАКАТ',
    display: '"Oswald", "Rubik", sans-serif',
    sans: '"PT Sans", "Rubik", sans-serif',
  },
  {
    id: 'modern',
    label: 'ГРОТЕСК',
    display: '"Unbounded", "Rubik Mono One", sans-serif',
    sans: '"Rubik", sans-serif',
  },
  {
    id: 'brutal',
    label: 'БРУТАЛ',
    display: '"Anton", "Rubik", sans-serif',
    sans: '"Rubik", sans-serif',
  },
];

export const DEFAULT_FONT_PRESET = FONT_PRESETS[0].id;

/** Push a preset's font stacks onto the document root so Tailwind's
 *  font-display / font-sans utilities (which read the vars) update everywhere. */
export function applyFontPreset(id: string): void {
  const preset = FONT_PRESETS.find((p) => p.id === id) ?? FONT_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty('--font-display', preset.display);
  root.style.setProperty('--font-sans', preset.sans);
}
