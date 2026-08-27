import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n/LanguageContext';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFS,
  displayToken,
  eventToToken,
  withBinding,
  type ShortcutAction,
  type ShortcutConfig,
} from '../shortcuts/registry';

interface ShortcutsOverlayProps {
  showShortcuts: boolean;
  setShowShortcuts: (show: boolean) => void;
  /** Live keybindings — this manual is also where they're configured. */
  shortcuts: ShortcutConfig;
  setShortcuts: (next: ShortcutConfig) => void;
}

// The COMMAND_CENTER: both the shortcut manual AND where shortcuts are rebound
// (moved here out of the Settings panel to keep that panel uncluttered). Each
// configurable key is a button — click to arm, press any key to bind, Escape to
// cancel. The Ctrl-combo / Escape keys are fixed and shown read-only.
export function ShortcutsOverlay({ showShortcuts, setShowShortcuts, shortcuts, setShortcuts }: ShortcutsOverlayProps) {
  const { t } = useI18n();
  const [capturing, setCapturing] = React.useState<ShortcutAction | null>(null);

  // Arm capture only while the manual is open; a closed manual must never eat keys.
  React.useEffect(() => {
    if (!capturing || !showShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      setShortcuts(withBinding(shortcuts, capturing, eventToToken(e)));
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, showShortcuts, shortcuts, setShortcuts]);

  // Reset capture whenever the manual closes.
  React.useEffect(() => { if (!showShortcuts) setCapturing(null); }, [showShortcuts]);

  const fixed = [
    { key: 'CTRL + SPACE', label: 'SPOTLIGHT_SEARCH' },
    { key: 'CTRL + K', label: 'SPOTLIGHT_SEARCH_ALT' },
    { key: 'ESC', label: 'CLOSE_MANUAL' },
  ];

  return (
    <AnimatePresence>
      {showShortcuts && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // z above the taskbar (9999) and any window (their z-index climbs as
          // they're focused, which is why z-50 let a focused window cover this).
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-brutal-black/90 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="brutal-card max-w-3xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar p-8 bg-brutal-black border-4 border-brutal-white shadow-[12px_12px_0px_0px_var(--brutal-shadow-color)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-6 border-b-4 border-brutal-white pb-4">
              <div>
                <h2 className="text-4xl font-display uppercase leading-none">COMMAND_CENTER</h2>
                <p className="font-mono text-xs text-brutal-neon mt-2 uppercase tracking-widest">{t('sc.rebindHint')}</p>
              </div>
              <button
                onClick={() => setShowShortcuts(false)}
                className="brutal-btn p-2 bg-brutal-neon text-brutal-black border-brutal-black shadow-brutal-black"
              >
                <X size={24} />
              </button>
            </div>

            {/* Configurable — click a key, then press a new one */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SHORTCUT_DEFS.map((def) => {
                const armed = capturing === def.action;
                return (
                  <div key={def.action} className="flex items-center gap-4 border-2 border-brutal-white/20 p-3">
                    <button
                      onClick={() => setCapturing(armed ? null : def.action)}
                      title={t('sc.rebindHint')}
                      className={`w-28 h-16 shrink-0 flex items-center justify-center font-display text-3xl uppercase border-2 transition-colors ${
                        armed
                          ? 'bg-brutal-neon text-brutal-black border-brutal-black animate-pulse text-lg'
                          : 'bg-brutal-white text-brutal-black border-brutal-black hover:bg-brutal-neon'
                      }`}
                    >
                      {armed ? t('sc.press') : displayToken(shortcuts[def.action])}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-brutal-white/40 uppercase">ACTION</p>
                      <p className="font-display text-lg uppercase leading-none truncate">{t(def.labelKey)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fixed keys — read-only */}
            <p className="font-mono text-[10px] text-brutal-white/30 uppercase tracking-widest mt-6 mb-2">SYSTEM // FIXED</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fixed.map((item) => (
                <div key={item.label} className="flex items-center gap-4 border-2 border-brutal-white/10 p-3 opacity-70">
                  <div className="w-28 h-16 shrink-0 flex items-center justify-center text-center bg-brutal-white/80 text-brutal-black font-display text-xs px-1 border-2 border-brutal-black">
                    {item.key}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-brutal-white/40 uppercase">ACTION</p>
                    <p className="font-display text-lg uppercase leading-none truncate">{item.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t-2 border-brutal-white/10 flex justify-between items-center gap-4">
              <button
                onClick={() => { setCapturing(null); setShortcuts({ ...DEFAULT_SHORTCUTS }); }}
                className="brutal-btn flex items-center gap-2 text-xs"
              >
                <RotateCcw size={14} /> {t('sc.reset')}
              </button>
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-brutal-neon animate-pulse" />
                <div className="w-2 h-2 bg-brutal-neon animate-pulse delay-75" />
                <div className="w-2 h-2 bg-brutal-neon animate-pulse delay-150" />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
