import React from 'react';
import { Wallpaper, WallpaperOverlay, DEFAULT_OVERLAY, ART_PRESETS, DEFAULT_WALLPAPER, imageLayerStyle, imageParamsOf } from '../theme/wallpapers';

// Just the wallpaper surface itself (one node per kind), with no wrapper/scrim.
// The overlay wrapper below adds dim/blur on top, so this stays focused on
// rendering the chosen preset / colour / image exactly as before.
const WallpaperContent: React.FC<{ wallpaper: Wallpaper; imageUrl: string | null; artUrl: string | null }> = ({ wallpaper, imageUrl, artUrl }) => {
  // 'image' draws a stored blob; 'art' draws the live now-playing cover. Both
  // share the exact same fit/zoom/pan/bleed rendering — only the source differs.
  if (wallpaper.kind === 'image' || wallpaper.kind === 'art') {
    const url = wallpaper.kind === 'art' ? artUrl : imageUrl;
    if (!url) {
      // Image not loaded yet / missing, or nothing playing (no cover) — fall back to ink.
      return <div className="absolute inset-0 bg-brutal-black" />;
    }
    const params = imageParamsOf(wallpaper);

    if (params.fit === 'tile') {
      return <div className="absolute inset-0" style={imageLayerStyle(url, params)} />;
    }

    // `contain` shows the whole image, which leaves bars whenever the image's
    // aspect ratio differs from the desktop's. Rather than dead black bars, fill
    // them with a blurred, dimmed blow-up of the same image so the wallpaper
    // reads as one continuous surface. `cover` needs no bleed — it already fills,
    // at the cost of cropping the edges.
    const showBleed = params.fit === 'contain';

    return (
      <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: 'var(--brutal-black)' }}>
        {showBleed && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              // Scale up so the blur's soft edge never exposes the container edge.
              transform: 'scale(1.15)',
              filter: 'blur(28px) brightness(0.45) saturate(1.1)',
            }}
          />
        )}
        <div className="absolute inset-0" style={imageLayerStyle(url, params)} />
      </div>
    );
  }

  if (wallpaper.kind === 'color') {
    return <div className="absolute inset-0" style={{ background: wallpaper.value }} />;
  }

  // preset. An unknown id (e.g. the removed 'constructivist', still persisted in
  // some users' localStorage) falls back to the default preset rather than blank.
  const preset =
    ART_PRESETS.find((p) => p.id === wallpaper.value) ??
    ART_PRESETS.find((p) => p.id === DEFAULT_WALLPAPER.value);
  if (!preset) return <div className="absolute inset-0 bg-brutal-black" />;
  return <div className="absolute inset-0" style={preset.style} />;
};

// Renders the selected desktop wallpaper behind the windows. Sits at z-0 and is
// pointer-events:none so it never intercepts clicks / the desktop context menu.
// The custom image comes in as an object URL (App loads it from IndexedDB). The
// optional overlay adds a legibility scrim + blur on top of whatever's chosen.
export const WallpaperLayer: React.FC<{ wallpaper: Wallpaper; imageUrl: string | null; artUrl?: string | null; overlay?: WallpaperOverlay }> = ({
  wallpaper, imageUrl, artUrl = null, overlay,
}) => {
  const { dim, blur } = { ...DEFAULT_OVERLAY, ...overlay };
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        // Blur softens the wallpaper's own edges too; scale up a touch so the
        // container edge never shows through as a hairline.
        style={blur > 0 ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : undefined}
      >
        <WallpaperContent wallpaper={wallpaper} imageUrl={imageUrl} artUrl={artUrl} />
      </div>
      {dim > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim / 100})` }} />}
    </div>
  );
};
