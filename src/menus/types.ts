// The vocabulary of the context-menu layer. No React, no DOM, no app state —
// just the shapes that `registry.tsx` produces and `ContextMenu.tsx` renders.
import type { LucideIcon } from 'lucide-react';

export type MenuItem =
  | {
      kind: 'action';
      id: string;
      /** i18n key, resolved by the renderer via useI18n(). */
      labelKey: string;
      icon: LucideIcon;
      onSelect: () => void;
      disabled?: boolean;
      /** Destructive items get the warning treatment. */
      danger?: boolean;
    }
  | { kind: 'separator' }
  | {
      kind: 'submenu';
      id: string;
      labelKey: string;
      icon: LucideIcon;
      items: MenuItem[];
    };

/**
 * What was right-clicked. Add a variant here, add a builder in `registry.tsx`,
 * and the new menu works everywhere — no changes to App.tsx.
 */
export type MenuTarget =
  | { kind: 'desktop'; stationsEnabled?: boolean; youtubeEnabled?: boolean }
  | { kind: 'folder'; path: string }
  | { kind: 'video-folder'; path: string }
  | { kind: 'playlist'; id: string; name: string }
  /** A pinned album/artist icon. `key` is the album or artist name. */
  | { kind: 'pin'; pinKind: 'album' | 'artist'; key: string };

/** Where the menu is anchored, in viewport (fixed) coords. */
export interface MenuAnchor {
  x: number;
  y: number;
}

export interface MenuState extends MenuAnchor {
  target: MenuTarget;
}

/**
 * Everything the menus are allowed to do. Assembled once in App.tsx from the
 * useAudioPlayer surface and passed down, so the menu layer can never reach
 * into playback or window state on its own.
 */
export interface MenuActions {
  importFolder: () => void;
  importFiles: () => void;
  importVideoFolder: () => void;
  newPlaylist: () => void;
  newStation: () => void;
  newYouTube: () => void;
  resetLayout: () => void;
  changeWallpaper: () => void;
  openSettings: () => void;
  openFolder: (path: string) => void;
  deleteFolder: (path: string) => void;
  openVideoFolder: (path: string) => void;
  deleteVideoFolder: (path: string) => void;
  openPlaylist: (id: string) => void;
  deletePlaylist: (id: string) => void;
  /** Open a pinned album/artist's page in the library window. */
  openPin: (pinKind: 'album' | 'artist', key: string) => void;
  /** Remove the desktop icon (and any wires touching it). The music stays. */
  unpin: (pinKind: 'album' | 'artist', key: string) => void;
  /** Is this desktop icon pinned in place (undraggable)? Read while building. */
  iconLocked: (iconId: string) => boolean;
  /** Pin an icon to its current spot, or release an already-pinned one. */
  toggleIconLock: (iconId: string) => void;
  /**
   * Open the rename dialog for a folder icon. Sets a display nickname only —
   * the folder on disk is never touched. Works for music and video roots.
   */
  renameFolder: (path: string) => void;
}
