import React from 'react';
import { Upload, Trash2, RotateCcw, Move, Sparkles, ImageOff, Pipette, Contrast, Disc } from 'lucide-react';
import {
  Wallpaper, WallpaperOverlay, DEFAULT_OVERLAY, OVERLAY_DIM_MAX, OVERLAY_BLUR_MAX,
  ART_PRESETS, COLOR_PRESETS, IMAGE_FITS, IMAGE_FIT_LABELS, ZOOM_MIN, ZOOM_MAX,
  imageLayerStyle, imageParamsOf,
} from '../theme/wallpapers';
import { WallpaperLayer } from './WallpaperLayer';
import { getWallpaperImage } from '../services/wallpaperStore';

// The landscape Backgrounds manager window. A live preview (drag to pan, zoom
// bar to scale, fit-mode buttons) on the left; presets, colours, the imported-
// image gallery, import, and live-wallpaper placeholders on the right. All image
// math lives in theme/wallpapers (imageLayerStyle) so the preview and the real
// desktop render identically.
interface BackgroundsViewProps {
  wallpaper: Wallpaper;
  setWallpaper: (w: Wallpaper) => void;
  /** Legibility layer (dim/blur) applied over any wallpaper; persists across switches. */
  overlay: WallpaperOverlay;
  setOverlay: (o: WallpaperOverlay) => void;
  /** Object URL of the currently-selected image (App owns its lifecycle). */
  activeImageUrl: string | null;
  /** Live now-playing cover art URL, for the 'art' wallpaper (null if nothing playing). */
  artUrl: string | null;
  imageIds: string[];
  onImport: () => void;
  onSelectImage: (id: string) => void;
  onDeleteImage: (id: string) => void;
}

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="font-mono text-[10px] text-brutal-white/40 uppercase tracking-widest mb-2">{children}</p>
);

export const BackgroundsView: React.FC<BackgroundsViewProps> = ({
  wallpaper, setWallpaper, overlay, setOverlay, activeImageUrl, artUrl, imageIds, onImport, onSelectImage, onDeleteImage,
}) => {
  const isImage = wallpaper.kind === 'image';
  const isArt = wallpaper.kind === 'art';
  // Both stored images and live album art support the fit/zoom/pan controls.
  const positionable = isImage || isArt;
  const params = imageParamsOf(wallpaper);
  // The source URL behind the current positionable wallpaper (stored image or live cover).
  const activeUrl = isArt ? artUrl : activeImageUrl;
  const canPan = positionable && params.fit !== 'tile' && !!activeUrl;

  // Merge an image-param change into the wallpaper (value carries the fit).
  // Preserves the current kind so adjusting 'art' doesn't turn it into a static image.
  const patchImage = (patch: Partial<{ fit: string; zoom: number; posX: number; posY: number }>) =>
    setWallpaper({
      kind: isArt ? 'art' : 'image',
      imageId: wallpaper.imageId,
      value: patch.fit ?? params.fit,
      zoom: patch.zoom ?? params.zoom,
      posX: patch.posX ?? params.posX,
      posY: patch.posY ?? params.posY,
    });

  // ─── Gallery thumbnails (own object-URL lifecycle) ──────────────────────────
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      const entries = await Promise.all(imageIds.map(async (id) => [id, await getWallpaperImage(id)] as const));
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, blob] of entries) {
        if (blob) { const u = URL.createObjectURL(blob); map[id] = u; made.push(u); }
      }
      setThumbs(map);
    })();
    return () => { cancelled = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [imageIds]);

  // ─── Drag-to-pan on the preview ─────────────────────────────────────────────
  const previewRef = React.useRef<HTMLDivElement>(null);
  const startPan = (e: React.PointerEvent) => {
    if (!canPan) return;
    e.preventDefault();
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const from = { x: params.posX, y: params.posY };
    const move = (ev: PointerEvent) => {
      // Drag the image: moving right reveals the left edge, so position decreases.
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      patchImage({
        posX: Math.max(0, Math.min(100, from.x - dxPct)),
        posY: Math.max(0, Math.min(100, from.y - dyPct)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-brutal-black text-brutal-white overflow-hidden">
      {/* ─── Preview ──────────────────────────────────────────────────────────── */}
      <div className="md:w-[55%] shrink-0 p-4 flex flex-col gap-3 border-b-4 md:border-b-0 md:border-r-4 border-brutal-white">
        <Label>PREVIEW{canPan ? ' // DRAG_TO_POSITION' : ''}</Label>
        <div
          ref={previewRef}
          onPointerDown={startPan}
          className={`relative flex-1 min-h-[160px] border-4 border-brutal-white overflow-hidden bg-brutal-black shadow-[6px_6px_0px_0px_var(--brutal-shadow-color)] ${canPan ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
          {/* Reuse the exact desktop renderer so preview == reality */}
          <WallpaperLayer wallpaper={wallpaper} imageUrl={activeImageUrl} artUrl={artUrl} overlay={overlay} />
          {/* faint rule-of-thirds guide while panning is possible */}
          {canPan && (
            <div className="absolute inset-0 pointer-events-none opacity-30"
              style={{ backgroundImage: 'linear-gradient(var(--brutal-white) 1px, transparent 1px), linear-gradient(90deg, var(--brutal-white) 1px, transparent 1px)', backgroundSize: '33.33% 33.33%' }} />
          )}
          {canPan && (
            <div className="absolute bottom-2 right-2 bg-brutal-black/70 border border-brutal-white px-2 py-1 flex items-center gap-1 pointer-events-none">
              <Move size={11} /><span className="font-mono text-[9px]">{Math.round(params.posX)},{Math.round(params.posY)}</span>
            </div>
          )}
        </div>

        {/* Positioning controls (stored image OR live album art): fit + zoom + reset */}
        {positionable ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {IMAGE_FITS.map((f) => (
                <button key={f} onClick={() => patchImage({ fit: f })}
                  className={`brutal-btn text-xs py-2 ${params.fit === f ? 'bg-brutal-neon text-brutal-black border-brutal-black' : ''}`}>
                  {IMAGE_FIT_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-brutal-white/50 uppercase w-10">ZOOM</span>
              <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={params.zoom}
                onChange={(e) => patchImage({ zoom: parseFloat(e.target.value) })}
                className="flex-1 h-2 cursor-pointer" />
              <span className="font-mono text-[10px] text-brutal-neon tabular-nums w-10 text-right">{params.zoom.toFixed(2)}×</span>
              <button onClick={() => patchImage({ zoom: 1, posX: 50, posY: 50 })} title="Reset position & zoom"
                className="p-1.5 border-2 border-brutal-white/40 hover:border-brutal-neon hover:text-brutal-neon transition-colors">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        ) : (
          <p className="font-mono text-[10px] text-brutal-white/30 uppercase text-center py-2">
            SELECT_OR_IMPORT_AN_IMAGE_TO_POSITION_IT
          </p>
        )}
      </div>

      {/* ─── Right rail: sources ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 space-y-5">
        {/* Now-playing: live album-art wallpaper. Follows whatever is playing —
            no stored image, the desktop repaints as the track changes. */}
        <div>
          <Label>NOW_PLAYING</Label>
          <button
            onClick={() => setWallpaper({ kind: 'art', value: 'cover', zoom: 1, posX: 50, posY: 50 })}
            title="USE_CURRENT_ALBUM_ART"
            className={`w-full flex items-center gap-3 p-2 border-2 transition-colors text-left ${
              isArt ? 'border-brutal-neon' : 'border-brutal-white/30 hover:border-brutal-white'
            }`}
          >
            <div className="w-12 h-12 shrink-0 border-2 border-brutal-white/50 bg-brutal-black overflow-hidden flex items-center justify-center">
              {artUrl
                ? <img src={artUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                : <Disc size={18} className="text-brutal-white/30" />}
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-wide">USE_ALBUM_ART</p>
              <p className="font-mono text-[9px] text-brutal-white/40 uppercase truncate">
                {artUrl ? (isArt ? 'ACTIVE // FOLLOWS_TRACK' : 'LIVE_COVER_AS_WALLPAPER') : 'NOTHING_PLAYING'}
              </p>
            </div>
            {isArt && <span className="ml-auto shrink-0 font-mono text-[8px] bg-brutal-neon text-brutal-black px-1.5 py-0.5 uppercase">ON</span>}
          </button>
        </div>

        {/* Imported images gallery */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>MY_IMAGES</Label>
            <button onClick={onImport} className="brutal-btn text-[10px] py-1 px-2 flex items-center gap-1">
              <Upload size={12} /> IMPORT
            </button>
          </div>
          {imageIds.length === 0 ? (
            <div className="border-2 border-dashed border-brutal-white/20 p-6 flex flex-col items-center gap-2 text-brutal-white/30">
              <ImageOff size={24} />
              <p className="font-mono text-[10px] uppercase text-center">NO_IMPORTED_IMAGES</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {imageIds.map((id) => {
                const active = isImage && wallpaper.imageId === id;
                return (
                  <div key={id} className={`relative group aspect-video border-2 overflow-hidden cursor-pointer ${active ? 'border-brutal-neon' : 'border-brutal-white/30 hover:border-brutal-white'}`}
                    onClick={() => onSelectImage(id)}>
                    {thumbs[id]
                      ? <img src={thumbs[id]} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-brutal-white/5" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteImage(id); }}
                      title="Delete from import"
                      className="absolute top-1 right-1 p-1 bg-brutal-black/80 border border-brutal-white text-brutal-white opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all">
                      <Trash2 size={11} />
                    </button>
                    {active && <span className="absolute bottom-0 inset-x-0 bg-brutal-neon text-brutal-black font-mono text-[8px] text-center uppercase">ACTIVE</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Presets */}
        <div>
          <Label>PATTERNS</Label>
          <div className="grid grid-cols-4 gap-2">
            {ART_PRESETS.map((p) => {
              const active = wallpaper.kind === 'preset' && wallpaper.value === p.id;
              return (
                <button key={p.id} onClick={() => setWallpaper({ kind: 'preset', value: p.id })}
                  title={p.label}
                  className={`aspect-video border-2 ${active ? 'border-brutal-neon' : 'border-brutal-white/30 hover:border-brutal-white'}`}
                  style={p.style} />
              );
            })}
          </div>
        </div>

        {/* Colours (+ custom picker) */}
        <div>
          <Label>COLOURS</Label>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_PRESETS.map((c) => {
              const active = wallpaper.kind === 'color' && wallpaper.value.toLowerCase() === c.value.toLowerCase();
              return (
                <button key={c.id} onClick={() => setWallpaper({ kind: 'color', value: c.value })}
                  title={c.label}
                  className={`aspect-video border-2 ${active ? 'border-brutal-neon' : 'border-brutal-white/30 hover:border-brutal-white'}`}
                  style={{ background: c.value }} />
              );
            })}
            {/* Custom colour — a native picker hidden behind the swatch. Active
                whenever a colour that isn't one of the presets is selected. */}
            {(() => {
              const presetVals = COLOR_PRESETS.map((c) => c.value.toLowerCase());
              const isCustom = wallpaper.kind === 'color' && !presetVals.includes(wallpaper.value.toLowerCase());
              return (
                <label title="CUSTOM_COLOUR"
                  className={`relative aspect-video border-2 cursor-pointer flex items-center justify-center overflow-hidden ${isCustom ? 'border-brutal-neon' : 'border-brutal-white/30 hover:border-brutal-white'}`}
                  style={{ background: isCustom ? wallpaper.value : 'transparent' }}>
                  {!isCustom && <Pipette size={16} className="text-brutal-white/50" />}
                  <input type="color" value={isCustom ? wallpaper.value : '#888888'}
                    onChange={(e) => setWallpaper({ kind: 'color', value: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                </label>
              );
            })()}
          </div>
        </div>

        {/* Overlay — legibility scrim + blur, applied over ANY wallpaper so the
            desktop icons / spotlight / taskbar stay readable over bright art. */}
        <div>
          <Label>OVERLAY</Label>
          <div className="border-2 border-brutal-white/20 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Contrast size={13} className="text-brutal-white/50 shrink-0" />
              <span className="font-mono text-[10px] text-brutal-white/50 uppercase w-9">DIM</span>
              <input type="range" min={0} max={OVERLAY_DIM_MAX} step={1} value={overlay.dim}
                onChange={(e) => setOverlay({ ...overlay, dim: parseInt(e.target.value, 10) })}
                className="flex-1 h-2 cursor-pointer" />
              <span className="font-mono text-[10px] text-brutal-neon tabular-nums w-9 text-right">{overlay.dim}%</span>
            </div>
            <div className="flex items-center gap-3">
              <Sparkles size={13} className="text-brutal-white/50 shrink-0" />
              <span className="font-mono text-[10px] text-brutal-white/50 uppercase w-9">BLUR</span>
              <input type="range" min={0} max={OVERLAY_BLUR_MAX} step={1} value={overlay.blur}
                onChange={(e) => setOverlay({ ...overlay, blur: parseInt(e.target.value, 10) })}
                className="flex-1 h-2 cursor-pointer" />
              <span className="font-mono text-[10px] text-brutal-neon tabular-nums w-9 text-right">{overlay.blur}px</span>
            </div>
            {(overlay.dim > 0 || overlay.blur > 0) && (
              <button onClick={() => setOverlay(DEFAULT_OVERLAY)}
                className="font-mono text-[9px] text-brutal-white/50 hover:text-brutal-neon uppercase flex items-center gap-1 transition-colors">
                <RotateCcw size={11} /> RESET_OVERLAY
              </button>
            )}
          </div>
        </div>

        {/* Live wallpapers — placeholders for a future feature */}
        <div>
          <Label>LIVE // COMING_SOON</Label>
          <div className="grid grid-cols-3 gap-2">
            {['PULSE', 'WAVEFORM', 'STARFIELD'].map((name) => (
              <div key={name} title="Coming soon"
                className="relative aspect-video border-2 border-dashed border-brutal-white/20 flex flex-col items-center justify-center gap-1 text-brutal-white/30 cursor-not-allowed">
                <Sparkles size={16} />
                <span className="font-mono text-[8px] uppercase">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
