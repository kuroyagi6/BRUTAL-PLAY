import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, LayoutGrid, List, FileText, ListMusic, ListFilter, ChevronDown, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/LanguageContext';
import { SORT_MODES, type LibrarySortMode } from '../library/trackSort';
import { RATING_FILTERS, type RatingFilter } from '../library/explicit';
import type { LibraryViewMode } from './LibraryView';

const VIEW_MODES: LibraryViewMode[] = ['DEFAULT', 'COMPACT', 'TECHNICAL', 'GRID'];

const VIEW_ICONS: Record<LibraryViewMode, typeof List> = {
  DEFAULT: ListMusic,
  COMPACT: List,
  TECHNICAL: FileText,
  GRID: LayoutGrid,
};

interface LibraryControlsProps {
  /**
   * True when the window has room for full-size, labelled buttons. False
   * collapses back to the 26px icon buttons (the small-window look).
   */
  roomy: boolean;
  libraryViewMode: LibraryViewMode;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  librarySortMode: LibrarySortMode;
  setLibrarySortMode: (mode: LibrarySortMode) => void;
  /** View-menu open state is App-owned (it's toggled from outside too). */
  showViewMenu: boolean;
  setShowViewMenu: (show: boolean) => void;
  showSortMenu: boolean;
  setShowSortMenu: (show: boolean) => void;
  ratingFilter: RatingFilter;
  setRatingFilter: (filter: RatingFilter) => void;
  showRatingMenu: boolean;
  setShowRatingMenu: (show: boolean) => void;
  /** The artist page ignores view modes, so its header hides the VIEW control. */
  hideView?: boolean;
}

/**
 * The VIEW + SORT controls of the library header, in one place.
 *
 * They used to be two copies of the same ~80 lines (detail header and browse
 * header), both hardcoded to a 26px icon button that was hard to hit once the
 * window was maximized. This renders one pair that grows into full brutalist
 * buttons when the window is wide and animates back down to icons when it
 * isn't — `roomy` is measured from the panel, not the screen.
 */
export function LibraryControls({
  roomy,
  libraryViewMode, setLibraryViewMode,
  librarySortMode, setLibrarySortMode,
  showViewMenu, setShowViewMenu,
  showSortMenu, setShowSortMenu,
  ratingFilter, setRatingFilter,
  showRatingMenu, setShowRatingMenu,
  hideView = false,
}: LibraryControlsProps) {
  const { t } = useI18n();
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Click-away close. With buttons this size an open menu covers real content,
  // so requiring a second click on the button to dismiss it is a trap.
  React.useEffect(() => {
    if (!showViewMenu && !showSortMenu && !showRatingMenu) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
        setShowSortMenu(false);
        setShowRatingMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showViewMenu, showSortMenu, showRatingMenu, setShowViewMenu, setShowSortMenu, setShowRatingMenu]);

  const triggerClass = (open: boolean) =>
    roomy
      ? `flex items-center gap-2 border-4 px-4 py-3 font-display uppercase tracking-wider text-xs transition-all
         shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)]
         hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_var(--brutal-shadow-color)]
         active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_var(--brutal-shadow-color)]
         ${open
           ? 'bg-brutal-neon text-brutal-black border-brutal-black'
           : 'bg-brutal-white text-brutal-black border-brutal-white'}`
      : `w-[26px] h-[26px] p-1 flex items-center justify-center border-2 transition-colors ${
          open ? 'bg-brutal-neon text-brutal-black border-brutal-black' : 'border-brutal-white/20 hover:border-brutal-neon'
        }`;

  const menuClass = roomy
    ? 'absolute top-full left-0 mt-2 z-50 bg-brutal-black border-4 border-brutal-white shadow-[8px_8px_0px_0px_var(--brutal-shadow-color)] min-w-[220px]'
    : 'absolute top-full right-0 lg:right-auto lg:left-0 mt-2 z-50 bg-brutal-black border-4 border-brutal-white shadow-[4px_4px_0px_0px_var(--brutal-shadow-color)] min-w-[140px]';

  const itemClass = (active: boolean) =>
    `w-full text-left transition-colors flex items-center justify-between ${
      roomy ? 'px-4 py-3 font-display text-sm tracking-wider' : 'px-3 py-2 font-mono text-[10px]'
    } uppercase ${active ? 'bg-brutal-neon text-brutal-black' : 'text-brutal-white hover:bg-brutal-white/10'}`;

  const iconSize = roomy ? 18 : 14;
  const checkSize = roomy ? 14 : 10;

  // The label only exists in the roomy layout. It is a plain span on purpose:
  // animating its width from 0 to `auto` inside the button left it stuck at
  // width:0 (the animation never ran), so the button rendered label-less and
  // squashed. The size change is carried by the button's `layout` animation
  // instead, which can't fail closed like that.
  const label = (text: string, value: string) =>
    roomy ? (
      <span className="whitespace-nowrap">
        {text}
        <span className="opacity-50"> / </span>
        {value}
      </span>
    ) : null;

  const ViewIcon = VIEW_ICONS[libraryViewMode] ?? ListMusic;

  return (
    <div ref={wrapRef} className="relative flex gap-2">
      <div className={`relative ${hideView ? 'hidden' : ''}`}>
        <motion.button
          layout
          transition={{ duration: 0.18 }}
          onClick={() => { setShowViewMenu(!showViewMenu); setShowSortMenu(false); setShowRatingMenu(false); }}
          className={triggerClass(showViewMenu)}
          title={t('tip.view')}
        >
          <ViewIcon size={iconSize} />
          {label(t('lbl.view'), t(`mode.${libraryViewMode}`))}
          {roomy && <ChevronDown size={14} />}
        </motion.button>

        <AnimatePresence>
          {showViewMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={menuClass}
            >
              {VIEW_MODES.map((mode) => {
                const Icon = VIEW_ICONS[mode];
                return (
                  <button
                    key={mode}
                    onClick={() => { setLibraryViewMode(mode); setShowViewMenu(false); }}
                    className={itemClass(libraryViewMode === mode)}
                  >
                    <span className="flex items-center gap-2">
                      {roomy && <Icon size={16} />}
                      {t(`mode.${mode}`)}
                    </span>
                    {libraryViewMode === mode && <Zap size={checkSize} />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <motion.button
          layout
          transition={{ duration: 0.18 }}
          onClick={() => { setShowSortMenu(!showSortMenu); setShowViewMenu(false); setShowRatingMenu(false); }}
          className={triggerClass(showSortMenu)}
          title={t('tip.sort')}
        >
          <ListFilter size={iconSize} />
          {label(t('lbl.sort'), t(`mode.${librarySortMode}`))}
          {roomy && <ChevronDown size={14} />}
        </motion.button>

        <AnimatePresence>
          {showSortMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={menuClass}
            >
              {SORT_MODES.map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setLibrarySortMode(mode); setShowSortMenu(false); }}
                  className={itemClass(librarySortMode === mode)}
                >
                  {t(`mode.${mode}`)}
                  {librarySortMode === mode && <Zap size={checkSize} />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <motion.button
          layout
          transition={{ duration: 0.18 }}
          onClick={() => { setShowRatingMenu(!showRatingMenu); setShowViewMenu(false); setShowSortMenu(false); }}
          className={triggerClass(showRatingMenu)}
          title={t('tip.rating')}
        >
          <ShieldAlert size={iconSize} />
          {label(t('lbl.rating'), t(`mode.${ratingFilter}`))}
          {roomy && <ChevronDown size={14} />}
        </motion.button>

        <AnimatePresence>
          {showRatingMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={menuClass}
            >
              {RATING_FILTERS.map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setRatingFilter(mode); setShowRatingMenu(false); }}
                  className={itemClass(ratingFilter === mode)}
                >
                  {t(`mode.${mode}`)}
                  {ratingFilter === mode && <Zap size={checkSize} />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
