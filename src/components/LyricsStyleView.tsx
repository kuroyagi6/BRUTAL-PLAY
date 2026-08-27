// STYLE tab: how the lyrics are drawn. Every control writes through
// useLyricsStyle, which persists and broadcasts — so the NOW tab (and a
// popped-out lyrics window) restyle as you drag, with no prop threading.
//
// The preview at the top renders through the SAME lineClass/lineStyle helpers
// the real view uses, so it can't lie about the result.
import React from 'react';
import { RotateCcw, Type, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import {
  useLyricsStyle,
  lineClass,
  lineStyle,
  ALIGN_CLASS,
  BG_CLASS,
  SIZE_RANGE,
  SPACING_RANGE,
  type LyricsStyle,
  type LyricsFont,
  type LyricsAlign,
  type LyricsBg,
} from '../hooks/useLyricsStyle';

const PREVIEW = ['the line before this one', 'THE LINE PLAYING NOW', 'and the one coming up'];

interface ToggleProps {
  label: string;
  on: boolean;
  onClick: () => void;
}

const Toggle: React.FC<ToggleProps> = ({ label, on, onClick }) => (
  <button
    onClick={onClick}
    className={`p-2 border-2 flex items-center justify-between font-mono text-[10px] uppercase transition-colors ${
      on
        ? 'bg-brutal-neon text-brutal-black border-brutal-black'
        : 'border-brutal-white/20 text-brutal-white hover:border-brutal-neon'
    }`}
  >
    <span className="truncate">{label}</span>
    <span className="font-display ml-2">{on ? 'ON' : 'OFF'}</span>
  </button>
);

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, suffix = '', onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between items-end">
      <span className="font-mono text-[10px] text-brutal-white/50 uppercase">{label}</span>
      <span className="font-display text-lg text-brutal-neon">{Math.round(value)}{suffix}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step="1"
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(parseFloat(e.target.value))}
      className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer"
    />
  </div>
);

interface ChoiceProps<T> {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
}

function Choice<T>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <div className="space-y-1">
      <span className="font-mono text-[10px] text-brutal-white/50 uppercase">{label}</span>
      <div className="flex">
        {options.map((o, i) => (
          <button
            key={i}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex-1 p-2 border-2 border-r-0 last:border-r-2 font-mono text-[10px] uppercase flex items-center justify-center transition-colors ${
              o.value === value
                ? 'bg-brutal-neon text-brutal-black border-brutal-black'
                : 'border-brutal-white/20 text-brutal-white hover:border-brutal-neon'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const LyricsStyleView: React.FC = () => {
  const { style, set, reset } = useLyricsStyle();

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      {/* Live preview, drawn by the real renderer's helpers. */}
      <div className={`p-4 border-b-4 border-brutal-white ${BG_CLASS[style.bg] || 'bg-brutal-black'}`}>
        {style.header && (
          <div className={`${ALIGN_CLASS[style.align]} mb-4`}>
            <h3 className="font-display text-lg text-brutal-neon uppercase tracking-tighter">TRACK_TITLE</h3>
            <p className="font-mono text-[10px] text-brutal-white/50">ARTIST_NAME</p>
          </div>
        )}
        {PREVIEW.map((text, i) => {
          const state = i === 1 ? 'active' : i === 0 ? 'passed' : 'upcoming';
          return (
            <div key={i} className={lineClass(style, state)} style={lineStyle(style, state)}>
              {text}
            </div>
          );
        })}
      </div>

      <div className="p-4 space-y-4">
        <Choice<LyricsFont>
          label="FONT"
          value={style.font}
          onChange={(font: LyricsFont) => set({ font })}
          options={[
            { value: 'display', label: 'DISPLAY' },
            { value: 'mono', label: 'MONO' },
            { value: 'sans', label: 'SANS' },
          ]}
        />

        <Choice<LyricsAlign>
          label="ALIGN"
          value={style.align}
          onChange={(align: LyricsAlign) => set({ align })}
          options={[
            { value: 'left', label: <AlignLeft size={14} />, title: 'Left' },
            { value: 'center', label: <AlignCenter size={14} />, title: 'Center' },
            { value: 'right', label: <AlignRight size={14} />, title: 'Right' },
          ]}
        />

        <Slider
          label="SIZE"
          value={style.size}
          min={SIZE_RANGE.min}
          max={SIZE_RANGE.max}
          suffix="PX"
          onChange={(size: number) => set({ size })}
        />
        <Slider
          label="LINE_GAP"
          value={style.spacing}
          min={SPACING_RANGE.min}
          max={SPACING_RANGE.max}
          suffix="PX"
          onChange={(spacing: number) => set({ spacing })}
        />
        <Slider
          label="INACTIVE_LINES"
          value={style.dim}
          min={0}
          max={100}
          suffix="%"
          onChange={(dim: number) => set({ dim })}
        />

        <Choice<LyricsBg>
          label="BACKDROP"
          value={style.bg}
          onChange={(bg: LyricsBg) => set({ bg })}
          options={[
            { value: 'none', label: 'NONE', title: 'Let the wallpaper through' },
            { value: 'dim', label: 'DIM' },
            { value: 'solid', label: 'SOLID' },
          ]}
        />

        <div className="grid grid-cols-2 gap-2">
          <Toggle label="UPPERCASE" on={style.upper} onClick={() => set({ upper: !style.upper })} />
          <Toggle label="ACCENT_LINE" on={style.accent} onClick={() => set({ accent: !style.accent })} />
          <Toggle label="GLOW" on={style.glow} onClick={() => set({ glow: !style.glow })} />
          <Toggle label="BLUR_REST" on={style.focus} onClick={() => set({ focus: !style.focus })} />
          <Toggle label="TRACK_HEADER" on={style.header} onClick={() => set({ header: !style.header })} />
        </div>

        <button onClick={reset} className="brutal-btn text-xs w-full flex items-center justify-center gap-2">
          <RotateCcw size={14} /> RESET_TO_DEFAULTS
        </button>

        <p className="font-mono text-[10px] text-brutal-white/30 uppercase flex items-start gap-2">
          <Type size={12} className="shrink-0 mt-0.5" />
          APPLIES_TO_EVERY_LYRICS_VIEW_INCLUDING_POPPED_OUT_WINDOWS.
        </p>
      </div>
    </div>
  );
};
