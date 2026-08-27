import React from 'react';
import { SlidersHorizontal, Waves, AudioLines, Gauge, Volume2, VolumeX, RotateCcw, Flame, ChevronDown, Repeat, Move3d, Activity, Droplet } from 'lucide-react';
import { usePlayer } from '../player/PlayerContext';
import { usePersistentState } from '../hooks/usePersistentState';
import { useElementWidth } from '../hooks/useElementWidth';
import { FxAnalyzer } from './FxAnalyzer';

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const DELAY_TIMES = [0.125, 0.25, 0.375, 0.5];

/**
 * Width at which the rack splits into controls + analyzer. Below it the rack is
 * a single scrolling column of collapsible modules; above it the controls take
 * a fixed column and the analyzer gets everything else.
 */
const WIDE_AT = 720;
const CONTROLS_WIDTH = 420;

/**
 * One rack module. Collapsible: the header is the toggle, and the folded state
 * is persisted per module — in a narrow window every module open is a long
 * scroll, and which ones you care about is personal.
 */
function RackModule({
  id, icon, label, right, collapsed, onToggle, children,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-2 border-brutal-white/20">
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          onClick={() => onToggle(id)}
          className="flex items-center gap-2 text-brutal-neon min-w-0 hover:opacity-70 transition-opacity"
          title={collapsed ? `EXPAND ${label}` : `COLLAPSE ${label}`}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          {icon}
          <span className="font-mono text-[10px] uppercase tracking-widest truncate">{label}</span>
        </button>
        {right}
      </div>
      {!collapsed && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** The big neon number every module puts in its header. */
function Readout({ children }: { children: React.ReactNode }) {
  return <span className="font-display text-lg text-brutal-neon leading-none shrink-0">{children}</span>;
}

export function FxRackView() {
  const {
    eq, updateEq, distortion, updateDistortion,
    crossfade, setCrossfade, normalizeVolume, setNormalizeVolume,
    playbackRate, setPlaybackRate, volume, setVolume, isMuted, toggleMute,
    reverb, setReverb, delay, setDelay, delayTime, setDelayTime,
    stereoWidth, setStereoWidth, resetSpatialFx,
  } = usePlayer();

  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const wide = rootWidth >= WIDE_AT;

  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>('brutal-fxCollapsed', {});
  const toggle = React.useCallback(
    (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] })),
    [setCollapsed]
  );

  const resetEq = () => {
    (['bass', 'mid', 'treble'] as const).forEach((b) => updateEq(b, 0));
    updateDistortion(0);
  };

  const widthLabel = stereoWidth === 0 ? 'MONO' : stereoWidth === 100 ? 'STEREO' : `${stereoWidth}%`;

  const modules = (
    <>
      {/* EQUALIZER */}
      <RackModule id="eq" icon={<SlidersHorizontal size={14} />} label="EQUALIZER // 3-BAND" collapsed={!!collapsed.eq} onToggle={toggle}>
        <div className="space-y-3">
          {(['bass', 'mid', 'treble'] as const).map((band) => (
            <div key={band}>
              <div className="flex justify-between items-end mb-1">
                <span className="font-mono text-[10px] text-brutal-white/50 uppercase">{band}</span>
                <span className="font-display text-lg text-brutal-neon leading-none">
                  {eq[band] > 0 ? '+' : ''}{Math.round(eq[band])}<span className="text-xs">DB</span>
                </span>
              </div>
              <input
                type="range" min="-12" max="12" step="1" value={eq[band]}
                onChange={(e) => updateEq(band, parseFloat(e.target.value))}
                onPointerDown={(e) => e.stopPropagation()}
                className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer"
                style={{ ['--track-h' as any]: '24px' }}
              />
            </div>
          ))}
        </div>
      </RackModule>

      {/* DRIVE */}
      <RackModule
        id="drive"
        icon={<Flame size={14} />}
        label="DRIVE // DISTORTION"
        collapsed={!!collapsed.drive}
        onToggle={toggle}
        right={<Readout>{distortion}%</Readout>}
      >
        <input
          type="range" min="0" max="100" step="1" value={distortion}
          onChange={(e) => updateDistortion(parseFloat(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-neon appearance-none cursor-pointer"
          style={{ ['--track-h' as any]: '24px' }}
        />
      </RackModule>

      {/* SPACE — convolution reverb (src/audio/spatialFx.ts) */}
      <RackModule
        id="reverb"
        icon={<Droplet size={14} />}
        label="SPACE // REVERB"
        collapsed={!!collapsed.reverb}
        onToggle={toggle}
        right={<Readout>{reverb === 0 ? 'DRY' : `${reverb}%`}</Readout>}
      >
        <input
          type="range" min="0" max="100" step="1" value={reverb}
          onChange={(e) => setReverb(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer"
          style={{ ['--track-h' as any]: '24px' }}
        />
      </RackModule>

      {/* ECHO — delay line with feedback */}
      <RackModule
        id="delay"
        icon={<Repeat size={14} />}
        label="ECHO // DELAY"
        collapsed={!!collapsed.delay}
        onToggle={toggle}
        right={<Readout>{delay === 0 ? 'OFF' : `${delay}%`}</Readout>}
      >
        <input
          type="range" min="0" max="100" step="1" value={delay}
          onChange={(e) => setDelay(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer"
          style={{ ['--track-h' as any]: '24px' }}
        />
        <div className="grid grid-cols-4 gap-1 mt-2">
          {DELAY_TIMES.map((secs) => (
            <button
              key={secs}
              onClick={() => setDelayTime(secs)}
              className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                delayTime === secs ? 'bg-brutal-neon text-brutal-black border-brutal-black' : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              {secs * 1000}MS
            </button>
          ))}
        </div>
      </RackModule>

      {/* STEREO — mid/side width */}
      <RackModule
        id="width"
        icon={<Move3d size={14} />}
        label="STEREO // WIDTH"
        collapsed={!!collapsed.width}
        onToggle={toggle}
        right={<Readout>{widthLabel}</Readout>}
      >
        <input
          type="range" min="0" max="200" step="5" value={stereoWidth}
          onChange={(e) => setStereoWidth(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="brutal-slider w-full h-6 bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer"
          style={{ ['--track-h' as any]: '24px' }}
        />
        <div className="flex justify-between mt-1 font-mono text-[9px] uppercase text-brutal-white/40">
          <span>MONO</span>
          <span>STEREO</span>
          <span>WIDE</span>
        </div>
      </RackModule>

      {/* DYNAMICS */}
      <RackModule id="dynamics" icon={<AudioLines size={14} />} label="DYNAMICS" collapsed={!!collapsed.dynamics} onToggle={toggle}>
        <button
          onClick={() => setNormalizeVolume(!normalizeVolume)}
          className={`w-full p-2 border-2 flex items-center justify-between font-mono text-xs uppercase transition-colors ${
            normalizeVolume ? 'bg-brutal-neon text-brutal-black border-brutal-black' : 'border-brutal-white/20 hover:border-brutal-neon'
          }`}
        >
          <span>NORMALIZE_VOLUME</span>
          <span className="font-display">{normalizeVolume ? 'ON' : 'OFF'}</span>
        </button>
      </RackModule>

      {/* CROSSFADE */}
      <RackModule
        id="crossfade"
        icon={<Waves size={14} />}
        label="CROSSFADE"
        collapsed={!!collapsed.crossfade}
        onToggle={toggle}
        right={<Readout>{crossfade === 0 ? 'OFF' : `${crossfade}S`}</Readout>}
      >
        <input
          type="range" min="0" max="10" step="1" value={crossfade}
          onChange={(e) => setCrossfade(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-2 cursor-pointer"
          style={{ accentColor: 'var(--brutal-accent)' }}
        />
      </RackModule>

      {/* SPEED */}
      <RackModule id="speed" icon={<Gauge size={14} />} label="PLAYBACK_SPEED" collapsed={!!collapsed.speed} onToggle={toggle}>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
          {SPEED_PRESETS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackRate(speed)}
              className={`p-2 border-2 font-mono text-[10px] uppercase transition-colors ${
                playbackRate === speed ? 'bg-brutal-neon text-brutal-black border-brutal-black' : 'border-brutal-white/20 hover:border-brutal-neon'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </RackModule>

      {/* OUTPUT */}
      <RackModule
        id="output"
        icon={isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        label="OUTPUT"
        collapsed={!!collapsed.output}
        onToggle={toggle}
        right={<Readout>{Math.round((isMuted ? 0 : volume) * 100)}%</Readout>}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMute}
            className={`p-2 border-2 transition-colors shrink-0 ${
              isMuted ? 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white' : 'border-brutal-white/20 text-brutal-white hover:border-brutal-neon'
            }`}
            title="Mute (M)"
          >
            {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range" min="0" max="100" value={Math.round((isMuted ? 0 : volume) * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVolume(v);
              if (isMuted && v > 0) toggleMute();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full h-2 cursor-pointer"
            style={{ accentColor: 'var(--brutal-accent)' }}
          />
        </div>
      </RackModule>
    </>
  );

  return (
    <div ref={rootRef} className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4 border-b-4 border-brutal-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal size={20} className="text-brutal-neon shrink-0" />
          <h3 className="text-2xl font-display uppercase text-brutal-white leading-none truncate">FX_RACK</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetSpatialFx}
            className="flex items-center gap-2 px-2 py-1 border-2 border-brutal-white/20 hover:border-brutal-neon font-mono text-[10px] uppercase transition-colors"
            title="Kill reverb, delay and width"
          >
            <Activity size={12} /> DRY
          </button>
          <button
            onClick={resetEq}
            className="flex items-center gap-2 px-2 py-1 border-2 border-brutal-white/20 hover:border-brutal-neon font-mono text-[10px] uppercase transition-colors"
            title="Flatten EQ + drive"
          >
            <RotateCcw size={12} /> FLAT
          </button>
        </div>
      </div>

      {/* Body. Wide: controls column + analyzer. Narrow: one scrolling column —
          the analyzer is deliberately absent there rather than squeezed into a
          strip too short to read, and it's the reason to maximize. */}
      {wide ? (
        <div className="flex-1 flex min-h-0">
          <div
            className="shrink-0 overflow-y-auto custom-scrollbar p-4 space-y-3 border-r-4 border-brutal-white"
            style={{ width: CONTROLS_WIDTH }}
          >
            {modules}
          </div>
          <div className="flex-1 min-w-0 p-4">
            <div className="h-full border-2 border-brutal-white/20 p-3 flex flex-col">
              <div className="flex items-center gap-2 text-brutal-neon mb-2 shrink-0">
                <Activity size={14} />
                <span className="font-mono text-[10px] uppercase tracking-widest">ANALYZER // EQ_RESPONSE</span>
              </div>
              <div className="flex-1 min-h-0">
                <FxAnalyzer />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">{modules}</div>
      )}
    </div>
  );
}
