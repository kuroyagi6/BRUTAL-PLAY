import React from 'react';
import { usePersistentState } from './usePersistentState';
import { Wallpaper, DEFAULT_WALLPAPER, WallpaperOverlay, DEFAULT_OVERLAY } from '../theme/wallpapers';
import { saveWallpaperImage, getWallpaperImage, listWallpaperImageIds, deleteWallpaperImage, LEGACY_IMAGE_ID } from '../services/wallpaperStore';

/**
 * Everything about the desktop wallpaper: the active wallpaper + legibility
 * overlay (persisted), the imported-image gallery, the object URL for the
 * currently-shown custom image (loaded from IndexedDB), and the handlers to
 * import / select / delete images. Self-contained — nothing here touches the
 * window system, audio, or library layers.
 */
export function useWallpaper() {
  const [wallpaper, setWallpaper] = usePersistentState<Wallpaper>('brutal-wallpaper', DEFAULT_WALLPAPER);
  // Legibility overlay (dim/blur) layered over any wallpaper. Persisted separately
  // so it survives switching wallpapers.
  const [wpOverlay, setWpOverlay] = usePersistentState<WallpaperOverlay>('brutal-wpOverlay', DEFAULT_OVERLAY);
  // Object URL for the custom wallpaper image, loaded from IndexedDB. `wpImgVersion`
  // bumps on upload to force a reload of the same 'image' selection.
  const [wpImageUrl, setWpImageUrl] = React.useState<string | null>(null);
  const [wpImgVersion, setWpImgVersion] = React.useState(0);
  // Ids of all imported wallpaper images (the Backgrounds gallery).
  const [wpImageIds, setWpImageIds] = React.useState<string[]>([]);
  const refreshWpImages = React.useCallback(async () => {
    try { setWpImageIds(await listWallpaperImageIds()); } catch { /* offline / no DB */ }
  }, []);
  React.useEffect(() => { refreshWpImages(); }, [refreshWpImages]);
  const wallpaperInputRef = React.useRef<HTMLInputElement>(null);

  // Load the custom wallpaper image blob from IndexedDB into an object URL when
  // the 'image' wallpaper is active; revoke it on change to avoid leaks.
  React.useEffect(() => {
    if (wallpaper.kind !== 'image') {
      setWpImageUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    // Legacy wallpapers have no imageId — fall back to the old single-slot key.
    const id = wallpaper.imageId ?? LEGACY_IMAGE_ID;
    getWallpaperImage(id).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setWpImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [wallpaper.kind, wallpaper.imageId, wpImgVersion]);

  // Store a picked image offline, add it to the gallery, and make it the active
  // wallpaper (FILL by default — full-bleed, reposition/zoom in the Backgrounds window).
  const handleWallpaperFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const id = await saveWallpaperImage(file);
      await refreshWpImages();
      setWpImgVersion((v) => v + 1);
      setWallpaper({ kind: 'image', value: 'cover', imageId: id, zoom: 1, posX: 50, posY: 50 });
    } catch (e) {
      console.error('Failed to save wallpaper image:', e);
    }
  };

  // Revert to a previously imported image (reset its framing to defaults).
  const selectWallpaperImage = (id: string) => {
    setWpImgVersion((v) => v + 1);
    setWallpaper({ kind: 'image', value: 'cover', imageId: id, zoom: 1, posX: 50, posY: 50 });
  };

  // Delete an imported image; if it was the active wallpaper, drop back to the default.
  const removeWallpaperImage = async (id: string) => {
    try {
      await deleteWallpaperImage(id);
      await refreshWpImages();
      if (wallpaper.kind === 'image' && (wallpaper.imageId ?? LEGACY_IMAGE_ID) === id) {
        setWallpaper(DEFAULT_WALLPAPER);
      }
    } catch (e) {
      console.error('Failed to delete wallpaper image:', e);
    }
  };

  return {
    wallpaper,
    setWallpaper,
    wpOverlay,
    setWpOverlay,
    wpImageUrl,
    wpImageIds,
    wallpaperInputRef,
    refreshWpImages,
    handleWallpaperFile,
    selectWallpaperImage,
    removeWallpaperImage,
  };
}
