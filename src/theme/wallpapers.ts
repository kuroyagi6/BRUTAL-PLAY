import type { CSSProperties } from 'react';

// Wallpaper model + built-in presets. Pure data — the WallpaperLayer component
// renders whatever is selected. The user's own image lives in IndexedDB
// (services/wallpaperStore); everything here is offline/self-contained.

// 'art' is a *live* wallpaper: it tracks the currently-playing song's cover art
// rather than a stored image, so there's no imageId — the live URL is fed in at
// render time. It reuses the image fit/zoom/pan params below.
export type WallpaperKind = 'preset' | 'color' | 'image' | 'art';

export interface Wallpaper {
  kind: WallpaperKind;
  /** preset id | CSS color/gradient | image|art fit ('cover' | 'contain' | 'tile') */
  value: string;
  /** kind==='image': which stored image (wallpaperStore id). */
  imageId?: string;
  /** kind==='image'|'art': extra scale on top of the fit (1 = none). */
  zoom?: number;
  /** kind==='image'|'art': pan focal point, 0–100 % (default centre 50/50). */
  posX?: number;
  posY?: number;
}

export const DEFAULT_WALLPAPER: Wallpaper = { kind: 'preset', value: 'concrete' };
export const IMAGE_FITS = ['contain', 'cover', 'tile'] as const;

// A legibility layer applied ON TOP of any wallpaper (preset / colour / image):
// a black scrim (dim) so the desktop icons, spotlight, wires and taskbar stay
// readable over bright art, plus an optional blur that pushes a busy photo back
// so it stops competing with the UI. Kept separate from `Wallpaper` on purpose —
// it survives switching between wallpapers instead of being wiped each time.
export interface WallpaperOverlay {
  /** Black scrim opacity, 0–100 %. */
  dim: number;
  /** Gaussian blur on the wallpaper, in px. */
  blur: number;
}
export const DEFAULT_OVERLAY: WallpaperOverlay = { dim: 0, blur: 0 };
export const OVERLAY_DIM_MAX = 85; // never fully black — always leave some art showing
export const OVERLAY_BLUR_MAX = 40;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

/** What each fit does to the image, said plainly on the buttons. */
export const IMAGE_FIT_LABELS: Record<(typeof IMAGE_FITS)[number], string> = {
  contain: 'WHOLE',
  cover: 'FILL',
  tile: 'TILE',
};

/** The image params, filled in with defaults for older/partial persisted values. */
export interface ImageParams {
  fit: string;
  zoom: number;
  posX: number;
  posY: number;
}
export const imageParamsOf = (w: Wallpaper): ImageParams => ({
  fit: IMAGE_FITS.includes(w.value as any) ? w.value : 'cover',
  zoom: typeof w.zoom === 'number' && w.zoom > 0 ? w.zoom : 1,
  posX: typeof w.posX === 'number' ? w.posX : 50,
  posY: typeof w.posY === 'number' ? w.posY : 50,
});

/**
 * The CSS for the foreground image layer (pure, so it's unit-testable and shared
 * by the live desktop AND the Backgrounds preview). `tile` repeats at a zoomable
 * cell size; `cover`/`contain` set the base fit, pan via background-position, and
 * apply `zoom` as an extra transform anchored at the pan point.
 */
export function imageLayerStyle(url: string, p: ImageParams): CSSProperties {
  if (p.fit === 'tile') {
    return {
      backgroundColor: 'var(--brutal-black)',
      backgroundImage: `url(${url})`,
      backgroundRepeat: 'repeat',
      backgroundSize: `${Math.round(200 * p.zoom)}px`,
    };
  }
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: p.fit,
    backgroundPosition: `${p.posX}% ${p.posY}%`,
    backgroundRepeat: 'no-repeat',
    transform: p.zoom === 1 ? undefined : `scale(${p.zoom})`,
    transformOrigin: `${p.posX}% ${p.posY}%`,
  };
}

export interface ArtPreset {
  id: string;
  label: string;
  /** Full-bleed background for the layer (and the swatch preview). */
  style: CSSProperties;
}

export const ART_PRESETS: ArtPreset[] = [
  {
    id: 'concrete',
    label: 'CONCRETE',
    style: {
      backgroundColor: '#17130F',
      backgroundImage:
        'radial-gradient(circle at 25% 15%, rgba(255,255,255,0.05), transparent 45%), radial-gradient(circle at 80% 70%, rgba(193,39,45,0.10), transparent 50%)',
    },
  },
  {
    id: 'blueprint',
    label: 'BLUEPRINT',
    style: {
      backgroundColor: '#0A2540',
      backgroundImage:
        'linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px)',
      backgroundSize: '44px 44px',
    },
  },
  {
    id: 'grid',
    label: 'GRID',
    style: {
      backgroundColor: '#14100E',
      backgroundImage:
        'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
      backgroundSize: '32px 32px',
    },
  },
  {
    id: 'hatch',
    label: 'HATCH',
    style: {
      backgroundColor: '#141210',
      backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 10px)',
    },
  },
];

export const COLOR_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'ink', label: 'INK', value: '#14100E' },
  { id: 'red', label: 'RED', value: '#C1272D' },
  { id: 'blue', label: 'BLUE', value: '#0A2540' },
  { id: 'cream', label: 'CREAM', value: '#E8E2D0' },
];
