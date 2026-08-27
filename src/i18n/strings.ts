// UI string table for the RU / EN / MIXED language toggle. Pure data + a
// translate() helper — no React/DOM. Components read it through the
// LanguageContext (useI18n). "mixed" shows both, Russian first.
//
// Coverage note: this table covers the chrome + Media Library (the strings that
// were localized). Other panels are English-only for now; adding them later is
// just more entries here + t() calls in those components.

export type Lang = 'ru' | 'en' | 'mixed';

interface Entry { en: string; ru: string; }

export const STRINGS: Record<string, Entry> = {
  // Window titles
  'win.library': { en: 'MEDIA_LIBRARY', ru: 'МЕДИАТЕКА' },
  'win.player': { en: 'STAGE', ru: 'СЦЕНА' },
  'win.lyrics': { en: 'LYRICS', ru: 'ТЕКСТЫ' },
  'win.queue': { en: 'UP_NEXT', ru: 'ОЧЕРЕДЬ' },
  'win.fx': { en: 'FX_RACK', ru: 'ЭФФЕКТЫ' },
  'win.settings': { en: 'SETTINGS', ru: 'НАСТРОЙКИ' },
  'win.backgrounds': { en: 'BACKGROUNDS', ru: 'ФОН' },
  'win.radar': { en: 'RADAR', ru: 'РАДАР' },
  'win.drive': { en: 'GOOGLE_DRIVE', ru: 'GOOGLE_ДИСК' },

  // System menu
  'menu.importFolder': { en: 'IMPORT_FOLDER', ru: 'ИМПОРТ ПАПКИ' },
  'menu.importVideoFolder': { en: 'IMPORT_VIDEO_FOLDER', ru: 'ИМПОРТ ВИДЕО ПАПКИ' },
  'menu.addFiles': { en: 'ADD_FILES', ru: 'ДОБАВИТЬ ФАЙЛЫ' },
  'menu.newPlaylist': { en: 'NEW_PLAYLIST', ru: 'НОВЫЙ ПЛЕЙЛИСТ' },
  'menu.newStation': { en: 'NEW_STATION', ru: 'НОВАЯ СТАНЦИЯ' },
  'menu.newYouTube': { en: 'NEW_YOUTUBE', ru: 'НОВЫЙ YOUTUBE' },
  'menu.resetLayout': { en: 'RESET_LAYOUT', ru: 'СБРОС МАКЕТА' },
  'menu.wallpaper': { en: 'CHANGE_WALLPAPER', ru: 'СМЕНИТЬ ОБОИ' },
  'menu.settings': { en: 'SETTINGS', ru: 'НАСТРОЙКИ' },
  'menu.openFolder': { en: 'OPEN', ru: 'ОТКРЫТЬ' },
  // Pinning an icon in place freezes its spot on the desktop — it says nothing
  // about the folder/playlist behind it, hence "IN_PLACE" rather than a bare
  // PIN (which on the album/artist menu would collide with UNPIN_ALBUM).
  'menu.pinIcon': { en: 'PIN_IN_PLACE', ru: 'ЗАКРЕПИТЬ_НА_МЕСТЕ' },
  'menu.unpinIcon': { en: 'UNPIN_IN_PLACE', ru: 'ОТКРЕПИТЬ_С_МЕСТА' },
  // Renames the icon's label only — never the folder on disk.
  'menu.renameFolder': { en: 'RENAME', ru: 'ПЕРЕИМЕНОВАТЬ' },
  'menu.deleteFolder': { en: 'DELETE_FOLDER_FROM_LIBRARY', ru: 'УДАЛИТЬ_ПАПКУ_ИЗ_МЕДИАТЕКИ' },
  'menu.deleteVideoFolder': { en: 'REMOVE_VIDEOS_FROM_LIBRARY', ru: 'УДАЛИТЬ_ВИДЕО_ИЗ_МЕДИАТЕКИ' },
  'menu.openPlaylist': { en: 'OPEN', ru: 'ОТКРЫТЬ' },
  'menu.deletePlaylist': { en: 'DELETE_PLAYLIST', ru: 'УДАЛИТЬ_ПЛЕЙЛИСТ' },
  'menu.openPin': { en: 'OPEN', ru: 'ОТКРЫТЬ' },
  // Unpinning only removes the desktop icon — the music is untouched, so this is
  // not a destructive item.
  'menu.unpinAlbum': { en: 'UNPIN_ALBUM', ru: 'ОТКРЕПИТЬ_АЛЬБОМ' },
  'menu.unpinArtist': { en: 'UNPIN_ARTIST', ru: 'ОТКРЕПИТЬ_АРТИСТА' },

  // Rack rail (formerly "taskbar")
  'os': { en: 'BRUTAL_RACK', ru: 'БРУТАЛ_СТОЙКА' },
  'start': { en: 'MODULES', ru: 'МОДУЛИ' },
  'noSignal': { en: 'NO SIGNAL', ru: 'НЕТ СИГНАЛА' },
  'active': { en: 'PATCHED', ru: 'В_РАБОТЕ' },
  'tb.launch': { en: 'PATCH_IN', ru: 'ПОДКЛЮЧИТЬ' },
  'tb.minimize': { en: 'STOW', ru: 'УБРАТЬ' },
  'tb.restore': { en: 'UNSTOW', ru: 'ВЕРНУТЬ' },
  'tb.openDeck': { en: 'OPEN_STAGE', ru: 'ОТКРЫТЬ_СЦЕНУ' },

  // Shortcuts (labels for the Settings rebind list + help manual)
  'sc.playPause': { en: 'PLAY / PAUSE', ru: 'ПУСК / ПАУЗА' },
  'sc.prev': { en: 'PREVIOUS_TRACK', ru: 'ПРЕДЫДУЩИЙ' },
  'sc.next': { en: 'NEXT_TRACK', ru: 'СЛЕДУЮЩИЙ' },
  'sc.shuffle': { en: 'TOGGLE_SHUFFLE', ru: 'ПЕРЕМЕШАТЬ' },
  'sc.repeat': { en: 'TOGGLE_REPEAT', ru: 'ПОВТОР' },
  'sc.mute': { en: 'TOGGLE_MUTE', ru: 'ЗВУК' },
  'sc.visualizer': { en: 'CYCLE_VISUALIZER', ru: 'ВИЗУАЛИЗАТОР' },
  'sc.theme': { en: 'INVERT_THEME', ru: 'СМЕНА_ТЕМЫ' },
  'sc.help': { en: 'TOGGLE_MANUAL', ru: 'СПРАВКА' },
  'sc.maximize': { en: 'SOLO_UNIT', ru: 'СОЛО_МОДУЛЬ' },
  'sc.minimize': { en: 'STOW_UNIT', ru: 'УБРАТЬ_МОДУЛЬ' },
  'sc.restore': { en: 'RESTORE_UNIT', ru: 'ВЕРНУТЬ_МОДУЛЬ' },
  'sc.close': { en: 'EJECT_UNIT', ru: 'ИЗВЛЕЧЬ_МОДУЛЬ' },
  'sc.snapLeft': { en: 'TILE_LEFT_HALF', ru: 'ПЛИТКА_ВЛЕВО' },
  'sc.snapRight': { en: 'TILE_RIGHT_HALF', ru: 'ПЛИТКА_ВПРАВО' },
  'sc.press': { en: 'PRESS_KEY', ru: 'НАЖМИТЕ' },
  'confirm.closeTitle': { en: 'EJECT_UNIT?', ru: 'ИЗВЛЕЧЬ_МОДУЛЬ?' },
  'confirm.cancel': { en: 'CANCEL', ru: 'ОТМЕНА' },
  'confirm.close': { en: 'EJECT', ru: 'ИЗВЛЕЧЬ' },
  'confirm.hint': { en: 'ENTER_TO_CONFIRM // ESC_TO_CANCEL', ru: 'ENTER_ПОДТВЕРДИТЬ // ESC_ОТМЕНА' },
  'sc.reset': { en: 'RESET_SHORTCUTS', ru: 'СБРОС_КЛАВИШ' },
  'sc.rebindHint': { en: 'CLICK_THEN_PRESS_A_KEY', ru: 'НАЖМИТЕ_ЗАТЕМ_КЛАВИШУ' },
  'tip.prev': { en: 'PREVIOUS', ru: 'НАЗАД' },
  'tip.playPause': { en: 'PLAY/PAUSE', ru: 'ПУСК/ПАУЗА' },
  'tip.next': { en: 'NEXT', ru: 'ВПЕРЁД' },
  'tip.seek': { en: 'SEEK', ru: 'ПЕРЕМОТКА' },

  // Library nav + headers
  'lib.songs': { en: 'SONGS', ru: 'ПЕСНИ' },
  'lib.albums': { en: 'ALBUMS', ru: 'АЛЬБОМЫ' },
  'lib.artists': { en: 'ARTISTS', ru: 'АРТИСТЫ' },
  'lib.genres': { en: 'GENRES', ru: 'ЖАНРЫ' },
  'lib.playlists': { en: 'PLAYLISTS', ru: 'ПЛЕЙЛИСТЫ' },
  'lib.allSongs': { en: 'ALL_SONGS', ru: 'ВСЕ ПЕСНИ' },

  // Units / counts
  'u.items': { en: 'ITEMS', ru: 'ЭЛЕМ.' },
  'u.tracks': { en: 'TRACKS', ru: 'ТРЕКОВ' },
  'u.trk': { en: 'TRK', ru: 'ТР' },
  'u.rel': { en: 'REL', ru: 'РЕЛ' },
  'u.releases': { en: 'RELEASES', ru: 'РЕЛИЗОВ' },
  'u.albums': { en: 'ALBUMS', ru: 'АЛЬБОМЫ' },
  'lbl.artist': { en: 'ARTIST', ru: 'АРТИСТ' },
  'unknown': { en: 'UNKNOWN', ru: 'НЕИЗВ.' },

  // View / sort modes (keyed by enum value; DEFAULT shared by both menus)
  'mode.DEFAULT': { en: 'DEFAULT', ru: 'ОБЫЧНО' },
  'mode.COMPACT': { en: 'COMPACT', ru: 'КОМПАКТ' },
  'mode.TECHNICAL': { en: 'TECHNICAL', ru: 'ТЕХ' },
  'mode.GRID': { en: 'GRID', ru: 'СЕТКА' },
  'mode.A-Z': { en: 'A-Z', ru: 'А-Я' },
  'mode.Z-A': { en: 'Z-A', ru: 'Я-А' },
  'mode.ARTIST': { en: 'ARTIST', ru: 'АРТИСТ' },
  'mode.ALBUM': { en: 'ALBUM', ru: 'АЛЬБОМ' },
  'mode.DURATION': { en: 'DURATION', ru: 'ДЛИНА' },

  // Content-rating filter (keyed by RatingFilter value)
  'mode.ALL': { en: 'ALL', ru: 'ВСЕ' },
  'mode.EXPLICIT': { en: 'EXPLICIT', ru: 'НЕЦЕНЗ.' },
  'mode.CLEAN': { en: 'CLEAN', ru: 'ЦЕНЗ.' },
  'lbl.rating': { en: 'RATING', ru: 'РЕЙТИНГ' },
  'tip.rating': { en: 'CONTENT_RATING_FILTER', ru: 'ФИЛЬТР ПО РЕЙТИНГУ' },
  'tip.markRating': { en: 'MARK EXPLICIT / CLEAN', ru: 'ОТМЕТИТЬ РЕЙТИНГ' },

  // Library tooltips / empty state / playlists
  'tip.view': { en: 'VIEW_OPTIONS', ru: 'ВИД' },
  'tip.sort': { en: 'SORT_OPTIONS', ru: 'СОРТИРОВКА' },
  // Short labels for the wide (maximized) library controls; the tip.* strings
  // stay the tooltips and are too long to sit inside a button.
  'lbl.view': { en: 'VIEW', ru: 'ВИД' },
  'lbl.sort': { en: 'SORT', ru: 'СОРТ' },
  'tip.removeFromPlaylist': { en: 'REMOVE FROM PLAYLIST', ru: 'УБРАТЬ ИЗ ПЛЕЙЛИСТА' },
  'tip.deleteTrack': { en: 'DELETE TRACK FROM LIBRARY', ru: 'УДАЛИТЬ ИЗ МЕДИАТЕКИ' },
  'empty.title': { en: 'NO_DATA_SYNCED', ru: 'НЕТ ДАННЫХ' },
  'empty.sub': { en: 'Import a music folder to initialize', ru: 'Импортируйте папку с музыкой' },
  'empty.cta': { en: 'IMPORT_MUSIC', ru: 'ИМПОРТ МУЗЫКИ' },
  'pl.newName': { en: 'NEW PLAYLIST NAME...', ru: 'НАЗВАНИЕ ПЛЕЙЛИСТА...' },
  'pl.add': { en: '+ PLAYLIST', ru: '+ ПЛЕЙЛИСТ' },
};

export function translate(lang: Lang, key: string): string {
  const e = STRINGS[key];
  if (!e) return key;
  if (lang === 'en') return e.en;
  if (lang === 'ru') return e.ru;
  return `${e.ru} · ${e.en}`; // mixed
}
