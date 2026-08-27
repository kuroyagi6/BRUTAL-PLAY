// LYRICS_CARD: pick some lines, get a shareable PNG.
//
// Draws to a canvas rather than screenshotting the DOM, because a canvas can be
// exported at poster resolution (1080px wide) regardless of window size, and
// needs no library. All the wrapping/sizing maths lives in utils/cardLayout as
// pure functions with a test; this file only draws and saves.
//
// The cover art is best-effort: an image the canvas considers cross-origin
// TAINTS it, and export then throws. So the card is drawn, export is tried, and
// on a security failure it is redrawn without the art and exported again —
// rather than handing back a broken download.
import React from 'react';
import { Download, Copy, X, Image as ImageIcon, Check } from 'lucide-react';
import type { Track } from '../types';
import { resolveSyncedLyrics } from '../utils/lrc';
import { CARD_SIZES, fitFontSize, cardFileName, type CardSize } from '../utils/cardLayout';

interface LyricsCardProps {
  currentTrack: Track | null;
  /** Line the song is on, pre-selected so the common case is one click. */
  activeIndex: number;
  onClose: () => void;
}

/** Resolve a CSS custom property to a concrete colour for canvas. */
function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** The real font stack behind a Tailwind class, so the card matches the app. */
function familyOf(className: string, fallback: string): string {
  try {
    const probe = document.createElement('span');
    probe.className = className;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const f = getComputedStyle(probe).fontFamily;
    probe.remove();
    return f || fallback;
  } catch {
    return fallback;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const LyricsCard: React.FC<LyricsCardProps> = ({ currentTrack, activeIndex, onClose }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState<CardSize>(CARD_SIZES[0]);
  const [selected, setSelected] = React.useState<number[]>([]);
  const [withArt, setWithArt] = React.useState<boolean>(true);
  const [status, setStatus] = React.useState<string | null>(null);

  const synced = resolveSyncedLyrics(currentTrack);
  const lines: string[] = React.useMemo(() => {
    if (synced) return synced.map((l) => l.text);
    return currentTrack?.lyrics ? currentTrack.lyrics.split('\n') : [];
  }, [synced, currentTrack?.lyrics]);

  // Start on the line that's playing — usually the one you wanted.
  React.useEffect(() => {
    setSelected(activeIndex >= 0 && activeIndex < lines.length ? [activeIndex] : []);
    // Only when the song changes: re-seeding on every progress tick would fight
    // the user's selection.
  }, [currentTrack?.id]);

  const toggle = (i: number) =>
    setSelected((prev: number[]) =>
      prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i].sort((a, b) => a - b)
    );

  // Selected lines in song order. Blank lines can't be selected (the picker
  // skips them), so there's nothing to filter out here.
  const chosen = selected.map((i: number) => lines[i] ?? '');

  // ─── Drawing ───────────────────────────────────────────────────────────────
  const draw = React.useCallback(
    async (art: boolean) => {
      const canvas = canvasRef.current;
      const track = currentTrack;
      if (!canvas || !track) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = size.width;
      canvas.height = size.height;

      const accent = cssVar('--accent', '#d4ff00');
      const display = familyOf('font-display', 'sans-serif');
      const mono = familyOf('font-mono', 'monospace');

      // Webfonts must be loaded before the first measure, or the layout is
      // computed against a fallback face and the text lands wrong.
      try {
        await (document as any).fonts?.ready;
      } catch {
        /* no font loading API — the fallback stack is fine */
      }

      const pad = Math.round(size.width * 0.08);
      const W = size.width;
      const H = size.height;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      // Brutal frame.
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.round(W * 0.012);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

      // Footer block: cover, title, artist.
      const footerH = Math.round(H * 0.16);
      const footerY = H - pad - footerH;
      let textX = pad;

      if (art && track.coverUrl) {
        const img = await loadImage(track.coverUrl);
        if (img) {
          const s = footerH;
          ctx.drawImage(img, pad, footerY, s, s);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.round(W * 0.006);
          ctx.strokeRect(pad, footerY, s, s);
          textX = pad + s + Math.round(pad * 0.5);
        }
      }

      const titleSize = Math.round(W * 0.038);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = accent;
      ctx.font = `${titleSize}px ${display}`;
      ctx.fillText((track.name || '').toUpperCase().slice(0, 34), textX, footerY + footerH * 0.45);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(titleSize * 0.62)}px ${mono}`;
      ctx.fillText((track.artist || '').toUpperCase().slice(0, 40), textX, footerY + footerH * 0.75);

      // Accent rule above the footer.
      ctx.fillStyle = accent;
      ctx.fillRect(pad, footerY - Math.round(pad * 0.4), W - pad * 2, Math.round(W * 0.008));

      // The quote, sized to fill what's left.
      const boxW = W - pad * 2;
      const boxH = footerY - Math.round(pad * 1.6) - pad;
      const lineHeight = 1.25;
      const measure = (text: string, fontSize: number) => {
        ctx.font = `${fontSize}px ${display}`;
        return ctx.measureText(text).width;
      };
      const fit = fitFontSize(chosen.length ? chosen : ['—'], {
        maxWidth: boxW,
        maxHeight: boxH,
        lineHeight,
        min: Math.round(W * 0.022),
        max: Math.round(W * 0.085),
        measure,
      });

      ctx.font = `${fit.fontSize}px ${display}`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      const step = fit.fontSize * lineHeight;
      let y = pad + Math.max(0, (boxH - fit.height) / 2);
      for (const line of fit.lines) {
        ctx.fillText(line, pad, y);
        y += step;
      }
    },
    [currentTrack, size, chosen.join('\n')]
  );

  React.useEffect(() => {
    draw(withArt);
  }, [draw, withArt]);

  // ─── Export ────────────────────────────────────────────────────────────────
  /** Canvas → blob, redrawing without the cover if the art tainted it. */
  const toBlob = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const attempt = () =>
      new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b: Blob | null) => resolve(b), 'image/png');
        } catch {
          resolve(null);
        }
      });

    let blob = await attempt();
    if (!blob && withArt) {
      // Tainted by the cover image — redraw without it and say so, rather than
      // failing silently on a card the user can see on screen.
      setWithArt(false);
      await draw(false);
      blob = await attempt();
      if (blob) setStatus('SAVED_WITHOUT_COVER_ART');
    }
    return blob;
  };

  const save = async () => {
    const blob = await toBlob();
    if (!blob || !currentTrack) {
      setStatus('EXPORT_FAILED');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cardFileName(currentTrack.artist || '', currentTrack.name || '', size.id);
    a.click();
    // Revoke on the next tick — immediately can cancel the download in Chromium.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus((s: string | null) => s || 'SAVED_TO_DOWNLOADS');
  };

  const copy = async () => {
    const blob = await toBlob();
    if (!blob) {
      setStatus('EXPORT_FAILED');
      return;
    }
    try {
      await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'image/png': blob })]);
      setStatus('COPIED_TO_CLIPBOARD');
    } catch {
      setStatus('CLIPBOARD_REFUSED // USE_SAVE');
    }
  };

  React.useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div className="absolute inset-0 z-30 bg-brutal-black flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b-4 border-brutal-white shrink-0">
        <span className="font-mono text-[11px] uppercase tracking-tighter flex items-center gap-2">
          <ImageIcon size={13} className="text-brutal-neon" /> LYRICS_CARD
        </span>
        <button onClick={onClose} className="p-1 border-2 border-brutal-white hover:bg-brutal-white/10">
          <X size={14} />
        </button>
      </div>

      {!currentTrack || lines.length === 0 ? (
        <p className="flex-1 flex items-center justify-center font-mono text-[10px] uppercase text-brutal-white/30 text-center p-6">
          {currentTrack ? 'THIS_TRACK_HAS_NO_LYRICS_TO_QUOTE' : 'NO_ACTIVE_TRACK'}
        </p>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Pick the lines */}
          <div className="lg:w-1/2 overflow-y-auto custom-scrollbar border-b-4 lg:border-b-0 lg:border-r-4 border-brutal-white max-h-[40%] lg:max-h-none">
            {lines.map((text: string, i: number) => {
              const on = selected.includes(i);
              if (!text.trim()) return null;
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`w-full text-left px-3 py-2 border-b border-brutal-white/10 font-mono text-[11px] flex items-start gap-2 transition-colors ${
                    on ? 'bg-brutal-neon text-brutal-black' : 'text-brutal-white/70 hover:bg-brutal-white/5'
                  }`}
                >
                  <span className={`shrink-0 w-3 ${on ? '' : 'opacity-20'}`}>{on ? <Check size={12} /> : '+'}</span>
                  <span className="truncate">{text}</span>
                </button>
              );
            })}
          </div>

          {/* Preview + controls */}
          <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto custom-scrollbar">
            <div className="flex-1 flex items-center justify-center min-h-0">
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain border-2 border-brutal-white/30"
              />
            </div>

            <div className="flex gap-1">
              {CARD_SIZES.map((s: CardSize) => (
                <button
                  key={s.id}
                  onClick={() => setSize(s)}
                  className={`flex-1 p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                    s.id === size.id
                      ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                      : 'border-brutal-white/20 hover:border-brutal-neon'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setWithArt(!withArt)}
                title="Include cover art"
                className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                  withArt
                    ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                    : 'border-brutal-white/20 hover:border-brutal-neon'
                }`}
              >
                ART
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={!selected.length}
                className="brutal-btn text-xs flex-1 flex items-center justify-center gap-2 disabled:opacity-30"
              >
                <Download size={14} /> SAVE_PNG
              </button>
              <button
                onClick={copy}
                disabled={!selected.length}
                className="brutal-btn text-xs flex items-center justify-center gap-2 disabled:opacity-30"
              >
                <Copy size={14} />
              </button>
            </div>

            <p className="font-mono text-[10px] uppercase text-brutal-white/30 text-center min-h-[1em]">
              {status || (selected.length ? `${selected.length}_LINES_SELECTED` : 'PICK_LINES_ON_THE_LEFT')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
