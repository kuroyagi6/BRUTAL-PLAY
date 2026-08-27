import React from 'react';
import type { BrutalWindowHandle } from '../components/BrutalWindow';

export type WinRuntime = { open: boolean; minimized: boolean };

/**
 * The window system's runtime state: which panels are open/minimized, which one
 * last took focus, the pending close-confirm target, and the imperative handles
 * per window. Also owns the "live copy" refs the long-lived global keydown
 * handler reads so it never acts on stale state (and stands down while a menu /
 * manual / confirm dialog owns the keyboard).
 *
 * Dynamic windows (folder:/playlist:/video:) share this same `winState` by key,
 * which is what makes minimize/close/taskbar work on them for free — callers add
 * and remove their entries through the returned `setWinState`.
 *
 * @param panelIds  ids of the fixed panels (WINDOW_DEFS) — used to boot every
 *                  panel running-but-minimized (clean desktop) and to reset.
 * @param showShortcuts  mirrored into `overlayOpenRef` so shortcuts stand down
 *                       while the help manual is open.
 */
export function useWindowManager(panelIds: string[], showShortcuts: boolean) {
  // Homepage boots as a clean/empty desktop: every panel we built is running but
  // minimized into the taskbar, so the user restores what they want. This also
  // clears the desktop for the folder drop-zone. `defaultOpen` is intentionally
  // ignored here — everything starts minimized.
  const initialWinState = React.useCallback(
    (): Record<string, WinRuntime> =>
      Object.fromEntries(panelIds.map((id) => [id, { open: true, minimized: true }])),
    [panelIds]
  );

  const [winState, setWinState] = React.useState<Record<string, WinRuntime>>(initialWinState);
  // Which window last took focus — the target for the maximize/minimize/restore/
  // close keybinds. Updated by each BrutalWindow's onFocus (fires on open + pointerdown).
  const [focusedWindowId, setFocusedWindowId] = React.useState<string | null>(null);
  // Keyboard "close" asks first; this holds the window id awaiting confirmation.
  const [closeConfirm, setCloseConfirm] = React.useState<string | null>(null);
  // Imperative handles per window id, so a keybind can maximize/restore the
  // focused one (that state is BrutalWindow-internal; minimize goes through winState).
  const winRefs = React.useRef<Record<string, BrutalWindowHandle | null>>({});

  // Live copies read by the (long-lived) global keydown handler so it never acts
  // on stale state, and so shortcuts stand down while a menu / manual / confirm
  // dialog is open (each owns arrow keys or Enter/Escape itself).
  const focusedWindowIdRef = React.useRef<string | null>(null);
  focusedWindowIdRef.current = focusedWindowId;
  const winStateRef = React.useRef(winState);
  winStateRef.current = winState;
  // Set by App from the context-menu state — the hook only provides the ref.
  const menuOpenRef = React.useRef(false);
  const overlayOpenRef = React.useRef(false);
  overlayOpenRef.current = showShortcuts;
  const confirmOpenRef = React.useRef(false);
  confirmOpenRef.current = !!closeConfirm;
  const closeConfirmRef = React.useRef<string | null>(null);
  closeConfirmRef.current = closeConfirm;

  // Reset every fixed panel back to running-but-minimized (dynamic windows are
  // cleared by the caller, which owns their open-lists).
  const resetWindows = () => setWinState(initialWinState());

  const toggleMinimize = (id: string) =>
    setWinState((s) => ({ ...s, [id]: { ...s[id], minimized: !s[id].minimized } }));

  const closeWindow = (id: string) =>
    setWinState((s) => ({ ...s, [id]: { ...s[id], open: false } }));

  // Launch/focus a window (used by the system menu to open Settings).
  const openWindow = (id: string) =>
    setWinState((s) => ({ ...s, [id]: { open: true, minimized: false } }));

  // Taskbar click: launch a closed window, restore a minimized one, or minimize
  // a visible one.
  const handleTaskbarClick = (id: string) =>
    setWinState((s) => {
      const w = s[id];
      if (!w.open) return { ...s, [id]: { open: true, minimized: false } };
      if (w.minimized) return { ...s, [id]: { ...w, minimized: false } };
      return { ...s, [id]: { ...w, minimized: true } };
    });

  return {
    winState,
    setWinState,
    resetWindows,
    toggleMinimize,
    closeWindow,
    openWindow,
    handleTaskbarClick,
    focusedWindowId,
    setFocusedWindowId,
    focusedWindowIdRef,
    closeConfirm,
    setCloseConfirm,
    closeConfirmRef,
    confirmOpenRef,
    winRefs,
    winStateRef,
    menuOpenRef,
    overlayOpenRef,
  };
}
