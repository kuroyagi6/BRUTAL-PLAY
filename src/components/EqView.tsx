import React from 'react';
import { Zap } from 'lucide-react';

interface EqViewProps {
  eq: { bass: number; mid: number; treble: number };
  updateEq: (band: 'bass' | 'mid' | 'treble', value: number) => void;
  distortion: number;
  updateDistortion: (value: number) => void;
  isMobile?: boolean;
}

export function EqView({ eq, updateEq, distortion, updateDistortion, isMobile = false }: EqViewProps) {
  const textSize = isMobile ? 'text-2xl' : 'text-xl';
  const sliderHeight = isMobile ? 'h-8' : 'h-6';
  const containerClass = isMobile ? '' : 'p-6 space-y-6';

  return (
    <div className={containerClass}>
      {isMobile && (
        <div className="flex items-center gap-3 mb-6 border-b-2 border-brutal-white/20 pb-2">
          <Zap className="text-brutal-neon" size={20} />
          <h2 className="font-display text-xl uppercase tracking-tighter">SIGNAL_EQ</h2>
        </div>
      )}
      <div className={isMobile ? 'space-y-6' : ''}>
        {(['bass', 'mid', 'treble'] as const).map((band) => (
          <div key={band} className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="font-mono text-[10px] text-brutal-white/50 uppercase">{band}</span>
              <span className={`font-display ${textSize} text-brutal-neon`}>{eq[band] > 0 ? '+' : ''}{Math.round(eq[band])}DB</span>
            </div>
            <input 
              type="range" 
              min="-12" 
              max="12" 
              step="1" 
              value={eq[band]} 
              onChange={(e) => updateEq(band, parseFloat(e.target.value))} 
              className={`brutal-slider w-full ${sliderHeight} bg-brutal-black border-2 border-brutal-white appearance-none cursor-pointer`} 
            />
          </div>
        ))}
      </div>
      <div className={isMobile ? 'mt-8 pt-6 border-t-2 border-brutal-white/20' : 'pt-4 border-t-2 border-brutal-white/20'}>
        <div className="space-y-2">
          <div className="flex justify-between items-end mb-2">
            <span className="font-mono text-[10px] text-brutal-white/50 uppercase">DRIVE</span>
            <span className={`font-display ${textSize} text-brutal-neon`}>{distortion}%</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            step="1" 
            value={distortion} 
            onChange={(e) => updateDistortion(parseFloat(e.target.value))} 
            className={`brutal-slider w-full ${sliderHeight} bg-brutal-black border-2 border-brutal-neon appearance-none cursor-pointer`} 
          />
        </div>
      </div>
    </div>
  );
}
