import React from 'react';
import { FolderOpen, Music, RotateCcw, Settings, Image as ImageIcon, Pin, PinOff, Trash2, ListMusic, Film, Radio, Youtube, User, Disc, FolderPen } from 'lucide-react';
import type { Lang } from '../i18n/strings';
import type { MenuActions, MenuItem, MenuTarget } from './types';

// Where menus are *defined*. One builder per right-click target. Adding a menu
// is one entry here plus one `menu.openAt(e, { kind: '...' })` on the element —
// App.tsx does not change. Mirrors the WINDOW_DEFS registry used for panels.

type Builder<K extends MenuTarget['kind']> = (
  target: Extract<MenuTarget, { kind: K }>,
  actions: MenuActions
) => MenuItem[];

const SEP: MenuItem = { kind: 'separator' };

// PIN_IN_PLACE / UNPIN_IN_PLACE — one toggle item, shared by every desktop icon
// menu. `iconId` is the id the position store uses for that icon (see
// iconPositionsResolved in App.tsx), which is also what useIconLock keys on.
//
// This is about the icon's *spot on the canvas*, not about the object: pinning a
// folder does not import anything, and unpinning it deletes nothing. It reads
// its current state at build time, which is safe because a menu is rebuilt on
// every open and closes the moment an item is chosen.
const lockItem = (iconId: string, a: MenuActions): MenuItem => {
  const locked = a.iconLocked(iconId);
  return {
    kind: 'action',
    id: 'lock',
    labelKey: locked ? 'menu.unpinIcon' : 'menu.pinIcon',
    icon: locked ? PinOff : Pin,
    onSelect: () => a.toggleIconLock(iconId),
  };
};

const MENU_BUILDERS: { [K in MenuTarget['kind']]: Builder<K> } = {
  desktop: (target, a) => [
    { kind: 'action', id: 'import-folder', labelKey: 'menu.importFolder', icon: FolderOpen, onSelect: a.importFolder },
    SEP,
    { kind: 'action', id: 'import-files', labelKey: 'menu.addFiles', icon: Music, onSelect: a.importFiles },
    SEP,
    { kind: 'action', id: 'import-video-folder', labelKey: 'menu.importVideoFolder', icon: Film, onSelect: a.importVideoFolder },
    SEP,
    { kind: 'action', id: 'new-playlist', labelKey: 'menu.newPlaylist', icon: ListMusic, onSelect: a.newPlaylist },
    // NEW_STATION only when the experimental radio layer is toggled on.
    ...(target.stationsEnabled
      ? ([
          SEP,
          { kind: 'action', id: 'new-station', labelKey: 'menu.newStation', icon: Radio, onSelect: a.newStation },
        ] as MenuItem[])
      : []),
    // NEW_YOUTUBE only when the experimental YouTube layer is toggled on.
    ...(target.youtubeEnabled
      ? ([
          SEP,
          { kind: 'action', id: 'new-youtube', labelKey: 'menu.newYouTube', icon: Youtube, onSelect: a.newYouTube },
        ] as MenuItem[])
      : []),
    SEP,
    { kind: 'action', id: 'reset-layout', labelKey: 'menu.resetLayout', icon: RotateCcw, onSelect: a.resetLayout },
    SEP,
    { kind: 'action', id: 'wallpaper', labelKey: 'menu.wallpaper', icon: ImageIcon, onSelect: a.changeWallpaper },
    SEP,
    { kind: 'action', id: 'settings', labelKey: 'menu.settings', icon: Settings, onSelect: a.openSettings },
  ],

  folder: (target, a) => [
    { kind: 'action', id: 'open', labelKey: 'menu.openFolder', icon: FolderOpen, onSelect: () => a.openFolder(target.path) },
    SEP,
    { kind: 'action', id: 'rename', labelKey: 'menu.renameFolder', icon: FolderPen, onSelect: () => a.renameFolder(target.path) },
    SEP,
    lockItem(`folder:${target.path}`, a),
    SEP,
    { kind: 'action', id: 'delete', labelKey: 'menu.deleteFolder', icon: Trash2, onSelect: () => a.deleteFolder(target.path) },
  ],

  'video-folder': (target, a) => [
    { kind: 'action', id: 'open', labelKey: 'menu.openFolder', icon: Film, onSelect: () => a.openVideoFolder(target.path) },
    SEP,
    { kind: 'action', id: 'rename', labelKey: 'menu.renameFolder', icon: FolderPen, onSelect: () => a.renameFolder(target.path) },
    SEP,
    lockItem(`video:${target.path}`, a),
    SEP,
    { kind: 'action', id: 'delete', labelKey: 'menu.deleteVideoFolder', icon: Trash2, danger: true, onSelect: () => a.deleteVideoFolder(target.path) },
  ],

  playlist: (target, a) => [
    { kind: 'action', id: 'open', labelKey: 'menu.openPlaylist', icon: ListMusic, onSelect: () => a.openPlaylist(target.id) },
    SEP,
    lockItem(`playlist:${target.id}`, a),
    SEP,
    { kind: 'action', id: 'delete', labelKey: 'menu.deletePlaylist', icon: Trash2, danger: true, onSelect: () => a.deletePlaylist(target.id) },
  ],

  // A pinned album/artist. UNPIN is not `danger`: it removes an icon, not music.
  pin: (target, a) => [
    {
      kind: 'action',
      id: 'open',
      labelKey: 'menu.openPin',
      icon: target.pinKind === 'artist' ? User : Disc,
      onSelect: () => a.openPin(target.pinKind, target.key),
    },
    SEP,
    // Same id shape as `pinId()` in library/pinnedNodes — this pins the icon's
    // spot, while UNPIN_ALBUM/ARTIST below removes the icon entirely.
    lockItem(`${target.pinKind}:${target.key}`, a),
    SEP,
    {
      kind: 'action',
      id: 'unpin',
      labelKey: target.pinKind === 'artist' ? 'menu.unpinArtist' : 'menu.unpinAlbum',
      icon: PinOff,
      onSelect: () => a.unpin(target.pinKind, target.key),
    },
  ],
};

/** Resolve the item list for whatever was right-clicked. */
export function buildMenu(target: MenuTarget, actions: MenuActions): MenuItem[] {
  const build = MENU_BUILDERS[target.kind] as Builder<MenuTarget['kind']>;
  return build(target as never, actions);
}

/** The panel header. Not every target needs one, but every current target has one. */
export function menuTitle(target: MenuTarget, lang: Lang): React.ReactNode {
  switch (target.kind) {
    case 'desktop':
      return (
        <>
          {lang === 'en' ? 'BRUTAL' : 'БРУТАЛ'}
          <span className="text-brutal-neon">{lang === 'en' ? 'PLAYER' : 'ПЛЕЕР'}</span>
        </>
      );
    case 'folder':
      return target.path;
    case 'video-folder':
      return target.path;
    case 'playlist':
      return target.name;
    case 'pin':
      return target.key;
  }
}
