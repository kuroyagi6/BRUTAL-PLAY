import React from 'react';
import type { MenuState, MenuTarget } from './types';

/**
 * One piece of state for every context menu in the app. Replaces the per-menu
 * `useState` pairs that used to accumulate in App.tsx — opening a menu for a new
 * kind of target costs nothing here.
 */
export interface ContextMenuController {
  state: MenuState | null;
  /** Open at the pointer, from a React right-click handler. Calls preventDefault. */
  openAt: (e: React.MouseEvent, target: MenuTarget) => void;
  /** Open at explicit viewport coords (the taskbar Start button has no event). */
  openAtPoint: (x: number, y: number, target: MenuTarget) => void;
  close: () => void;
}

export function useContextMenu(): ContextMenuController {
  const [state, setState] = React.useState<MenuState | null>(null);

  const openAt = React.useCallback((e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ target, x: e.clientX, y: e.clientY });
  }, []);

  const openAtPoint = React.useCallback((x: number, y: number, target: MenuTarget) => {
    setState({ target, x, y });
  }, []);

  const close = React.useCallback(() => setState(null), []);

  return { state, openAt, openAtPoint, close };
}
