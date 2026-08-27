import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n/LanguageContext';
import type { MenuItem } from './types';

// The one and only context-menu shell. Owns positioning, dismissal, keyboard
// navigation, submenus and the brutal panel chrome. It is purely presentational:
// it renders a MenuItem[] and calls the callbacks baked into those items, so it
// can never interfere with playback or window logic. Restyling every menu in the
// app is a single edit in this file.

const ITEM =
  'w-full text-left px-3 py-3 font-mono text-xs uppercase transition-colors flex items-center gap-3';
const DIVIDER = 'border-t-2 border-brutal-white/10';
const PANEL =
  'bg-brutal-black border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] min-w-[210px] text-brutal-white select-none';

const isFocusable = (item: MenuItem) =>
  item.kind === 'submenu' || (item.kind === 'action' && !item.disabled);

interface PanelProps {
  items: MenuItem[];
  /** Close the whole menu tree. */
  onClose: () => void;
  /** True when this panel is the deepest open one, so it owns the keyboard. */
  active: boolean;
  /** Present on submenus: hand the keyboard back to the parent panel. */
  onExit?: () => void;
  /** Submenus open leftward when the menu is anchored on the right half. */
  flipLeft: boolean;
}

const MenuPanel: React.FC<PanelProps> = ({ items, onClose, active, onExit, flipLeft }) => {
  const { t } = useI18n();
  const [index, setIndex] = React.useState(-1);
  const [openSub, setOpenSub] = React.useState<number | null>(null);

  // The panel below us owns the keyboard while a submenu is open.
  const ownsKeyboard = active && openSub === null;

  React.useEffect(() => {
    if (!ownsKeyboard) return;

    const focusable = items.map((it, i) => (isFocusable(it) ? i : -1)).filter((i) => i >= 0);
    if (focusable.length === 0) return;

    const step = (delta: number) => {
      const at = focusable.indexOf(index);
      const next = at === -1 ? (delta > 0 ? 0 : focusable.length - 1) : (at + delta + focusable.length) % focusable.length;
      setIndex(focusable[next]);
    };

    const onKey = (e: KeyboardEvent) => {
      const item = index >= 0 ? items[index] : undefined;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight' && item?.kind === 'submenu') {
        e.preventDefault();
        setOpenSub(index);
      } else if (e.key === 'ArrowLeft' && onExit) {
        e.preventDefault();
        onExit();
      } else if (e.key === 'Enter' && item) {
        e.preventDefault();
        if (item.kind === 'submenu') setOpenSub(index);
        else if (item.kind === 'action') {
          onClose();
          item.onSelect();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ownsKeyboard, items, index, onExit, onClose]);

  // First non-separator item skips the top divider, matching the old menus.
  let seenFirst = false;

  return (
    <>
      {items.map((item, i) => {
        if (item.kind === 'separator') return null; // rendered as the next item's top border

        const needsDivider = seenFirst;
        seenFirst = true;

        const highlighted = index === i || openSub === i;
        const hover = item.kind === 'action' && item.danger
          ? 'hover:bg-red-500 hover:text-brutal-white'
          : 'hover:bg-brutal-neon hover:text-brutal-black';
        const on = item.kind === 'action' && item.danger
          ? 'bg-red-500 text-brutal-white'
          : 'bg-brutal-neon text-brutal-black';

        const separatorBefore = needsDivider && items[i - 1]?.kind === 'separator';
        const cls = [
          ITEM,
          separatorBefore ? DIVIDER : '',
          item.kind === 'action' && item.disabled ? 'opacity-40 cursor-not-allowed' : hover,
          highlighted && !(item.kind === 'action' && item.disabled) ? on : '',
        ]
          .filter(Boolean)
          .join(' ');

        const Icon = item.icon;

        return (
          <div key={item.id} className="relative">
            <button
              type="button"
              disabled={item.kind === 'action' && item.disabled}
              onMouseEnter={() => {
                setIndex(i);
                setOpenSub(item.kind === 'submenu' ? i : null);
              }}
              onClick={() => {
                if (item.kind === 'submenu') setOpenSub(i);
                else {
                  onClose();
                  item.onSelect();
                }
              }}
              className={cls}
            >
              <Icon size={16} /> <span className="flex-1">{t(item.labelKey)}</span>
              {item.kind === 'submenu' && <ChevronRight size={14} />}
            </button>

            {item.kind === 'submenu' && openSub === i && (
              <div
                className={`absolute top-0 z-10 ${PANEL}`}
                style={flipLeft ? { right: '100%' } : { left: '100%' }}
                onMouseLeave={() => setOpenSub(null)}
              >
                <MenuPanel
                  items={item.items}
                  onClose={onClose}
                  active={active}
                  onExit={() => {
                    setOpenSub(null);
                    setIndex(i);
                  }}
                  flipLeft={flipLeft}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

interface ContextMenuProps {
  x: number;
  y: number;
  /** Optional panel header — a folder path, a brand mark, a track name. */
  title?: React.ReactNode;
  items: MenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, title, items, onClose }) => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer attaching so the very click/right-click that opened the menu does
    // not immediately close it.
    const raf = requestAnimationFrame(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('contextmenu', onDown);
      window.addEventListener('keydown', onKey);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('contextmenu', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Flip vertically/horizontally so the panel always stays inside the viewport.
  // Anchoring by bottom lets the taskbar Start menu open upward.
  const flipUp = y > window.innerHeight / 2;
  const flipLeft = x > window.innerWidth / 2;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: flipLeft ? undefined : x,
    right: flipLeft ? window.innerWidth - x : undefined,
    top: flipUp ? undefined : y,
    bottom: flipUp ? window.innerHeight - y : undefined,
    zIndex: 10000,
  };

  return (
    <div ref={ref} style={style} onContextMenu={(e) => e.preventDefault()} className={PANEL}>
      {title && (
        <div className="px-3 py-2 border-b-4 border-brutal-white font-display text-lg tracking-tighter uppercase leading-none break-all">
          {title}
        </div>
      )}
      <MenuPanel items={items} onClose={onClose} active flipLeft={flipLeft} />
    </div>
  );
};
