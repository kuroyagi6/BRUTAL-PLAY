import React from 'react';
import type { BrutalWindowHandle } from '../components/BrutalWindow';
import type { SnapZone } from '../components/windowSnap';
import type { WinRuntime } from './useWindowManager';
import { VIDEO_PLAYER_ID } from './useVideoWindows';
import { eventToToken, matchAction, type ShortcutConfig } from '../shortcuts/registry';

interface ShortcutDeps {
  shortcuts: ShortcutConfig;
  // In the effect's dep array so the handler re-binds when focus changes.
  focusedWindowId: string | null;

  // Live-copy refs (from useWindowManager) the once-bound handler reads so it
  // never acts on stale state.
  focusedWindowIdRef: React.MutableRefObject<string | null>;
  winStateRef: React.MutableRefObject<Record<string, WinRuntime>>;
  winRefs: React.MutableRefObject<Record<string, BrutalWindowHandle | null>>;
  confirmOpenRef: React.MutableRefObject<boolean>;
  closeConfirmRef: React.MutableRefObject<string | null>;
  menuOpenRef: React.MutableRefObject<boolean>;
  overlayOpenRef: React.MutableRefObject<boolean>;

  // Window actions (from useWindowManager).
  toggleMinimize: (id: string) => void;
  closeWindow: (id: string) => void;
  setCloseConfirm: React.Dispatch<React.SetStateAction<string | null>>;
  setFocusedWindowId: React.Dispatch<React.SetStateAction<string | null>>;

  // Dynamic-window teardown (from the explorer/video hooks) — performClose routes
  // by kind so the desktop icon / open-list stays in sync.
  closeFolder: (path: string) => void;
  closePlaylist: (id: string) => void;
  closeVideoFolder: (path: string) => void;
  closeVideoPlayer: () => void;

  // Transport (from the player).
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;

  // App-level toggles.
  setIsSpotlightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
  toggleTheme: () => void;
  toggleVisualizer: () => void;
}

/**
 * The single global keydown handler: spotlight (Ctrl/Cmd+K or Space), the
 * close-confirm dialog's Enter/Escape, and the user's configured transport /
 * window keybinds. Bound once in the capture phase so it fires before any
 * focused control; it reads live state via refs and stands down while a text
 * field, context menu, or the shortcut manual owns the keyboard.
 *
 * The window-op keybinds act on the focused window (maximize/minimize/restore/
 * snap via the imperative BrutalWindow handles; close stages a confirmation).
 * Returns `performClose`, which the confirm dialog's button also calls.
 */
export function useGlobalShortcuts(deps: ShortcutDeps) {
  const {
    shortcuts, focusedWindowId,
    focusedWindowIdRef, winStateRef, winRefs, confirmOpenRef, closeConfirmRef, menuOpenRef, overlayOpenRef,
    toggleMinimize, closeWindow, setCloseConfirm, setFocusedWindowId,
    closeFolder, closePlaylist, closeVideoFolder, closeVideoPlayer,
    togglePlay, playNext, playPrev, toggleMute, toggleShuffle, toggleRepeat,
    setIsSpotlightOpen, setShowShortcuts, toggleTheme, toggleVisualizer,
  } = deps;

  // ─── Window keybinds (act on the focused window) ────────────────────────────
  // These read live state via refs, because the global keydown handler that calls
  // them is bound once and would otherwise close over a stale focus/winState.
  const maximizeFocused = () => {
    const id = focusedWindowIdRef.current;
    if (id) winRefs.current[id]?.toggleMaximize();
  };
  const minimizeFocused = () => {
    const id = focusedWindowIdRef.current;
    const w = id ? winStateRef.current[id] : null;
    if (id && w?.open && !w.minimized) toggleMinimize(id);
  };
  // Restore: bring a minimized window back, or un-maximize a maximized one.
  const restoreFocused = () => {
    const id = focusedWindowIdRef.current;
    if (!id) return;
    if (winStateRef.current[id]?.minimized) toggleMinimize(id);
    else winRefs.current[id]?.restore();
  };
  // Split-screen: snap the focused window to a half/quadrant of the desktop.
  const snapFocused = (zone: SnapZone) => {
    const id = focusedWindowIdRef.current;
    if (id) winRefs.current[id]?.snap(zone);
  };

  // Actually tear the window down. Routes by kind — dynamic windows need their own
  // teardown so the desktop icon / open-list stays in sync.
  const performClose = (id: string | null) => {
    if (!id) return;
    if (id.startsWith('video:')) closeVideoFolder(id.slice('video:'.length));
    else if (id === VIDEO_PLAYER_ID) closeVideoPlayer();
    else if (id.startsWith('folder:')) closeFolder(id.slice('folder:'.length));
    else if (id.startsWith('playlist:')) closePlaylist(id.slice('playlist:'.length));
    else closeWindow(id);
    setCloseConfirm(null);
    setFocusedWindowId(null);
  };
  // The keybind never closes outright — it stages a confirmation (see the dialog).
  const closeFocused = () => {
    const id = focusedWindowIdRef.current;
    if (id) setCloseConfirm(id);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Spotlight must open from anywhere, including while a text field has focus.
      // Match on `code` as well as `key`: with a modifier held, some layouts and
      // IMEs report `key` as something other than ' '. Ctrl/Cmd+K is the escape
      // hatch for when the OS or an IME swallows Ctrl+Space before we see it.
      const spotlightKey =
        e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.key.toLowerCase() === 'k';
      if ((e.ctrlKey || e.metaKey) && !e.altKey && spotlightKey) {
        e.preventDefault();
        setIsSpotlightOpen(prev => !prev);
        return;
      }

      // The close-confirm dialog owns the keyboard while it's up: Enter confirms,
      // Escape cancels, everything else is swallowed.
      if (confirmOpenRef.current) {
        if (e.key === 'Enter') { e.preventDefault(); performClose(closeConfirmRef.current); }
        else if (e.key === 'Escape') { e.preventDefault(); setCloseConfirm(null); }
        return;
      }

      // Typing in a field (incl. range sliders, which use arrows) — don't hijack.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Escape stays fixed (not rebindable): close the help manual.
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        return;
      }

      // Stand down while a context menu or the shortcut manual is open — both run
      // their own arrow-key handlers (menu navigation / rebind capture), and the
      // manual is rebinding the very keys we'd otherwise fire on.
      if (menuOpenRef.current || overlayOpenRef.current) return;

      // Dispatch by the user's configured keybinding (defaults: Space + arrows
      // for transport). Bare keys only — combos were handled above.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const action = matchAction(shortcuts, eventToToken(e));
      if (!action) return;
      // Arrow keys / Space otherwise scroll the page — claim them once bound.
      e.preventDefault();
      switch (action) {
        case 'playPause': togglePlay(); break;
        case 'next': playNext(); break;
        case 'prev': playPrev(); break;
        case 'mute': toggleMute(); break;
        case 'shuffle': toggleShuffle(); break;
        case 'repeat': toggleRepeat(); break;
        case 'visualizer': toggleVisualizer(); break;
        case 'theme': toggleTheme(); break;
        case 'help': setShowShortcuts(prev => !prev); break;
        case 'maximize': maximizeFocused(); break;
        case 'minimize': minimizeFocused(); break;
        case 'restore': restoreFocused(); break;
        case 'close': closeFocused(); break;
        case 'snapLeft': snapFocused('left'); break;
        case 'snapRight': snapFocused('right'); break;
      }
    };

    // Capture phase: the shortcut fires before any focused control can consume it.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts, focusedWindowId, togglePlay, playNext, playPrev, toggleMute, toggleShuffle, toggleRepeat]);

  return { performClose };
}
