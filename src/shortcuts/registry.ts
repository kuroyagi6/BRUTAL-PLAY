// Pure keybinding model — no React, no DOM. The action list, the default keys,
// key<->token normalization, and the lookup/rebind logic all live here so the
// keydown handler (App), the Settings rebind UI, and the help overlay share one
// source of truth and can't drift. Tested via `npx tsx src/shortcuts/registry.test.ts`.

/** Every rebindable action. Spotlight (Ctrl+K / Ctrl+Space) and Escape are
 *  intentionally NOT here — they're modifier/system keys, handled separately. */
export type ShortcutAction =
  | 'playPause'
  | 'next'
  | 'prev'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'visualizer'
  | 'theme'
  | 'help'
  | 'maximize'
  | 'minimize'
  | 'restore'
  | 'close'
  | 'snapLeft'
  | 'snapRight';

export interface ShortcutDef {
  action: ShortcutAction;
  /** i18n key for the human label (see src/i18n/strings.ts). */
  labelKey: string;
}

// Order here is the order shown in Settings and the help overlay.
export const SHORTCUT_DEFS: ShortcutDef[] = [
  { action: 'playPause', labelKey: 'sc.playPause' },
  { action: 'prev', labelKey: 'sc.prev' },
  { action: 'next', labelKey: 'sc.next' },
  { action: 'shuffle', labelKey: 'sc.shuffle' },
  { action: 'repeat', labelKey: 'sc.repeat' },
  { action: 'mute', labelKey: 'sc.mute' },
  { action: 'visualizer', labelKey: 'sc.visualizer' },
  { action: 'theme', labelKey: 'sc.theme' },
  { action: 'help', labelKey: 'sc.help' },
  // Window ops — act on the focused window.
  { action: 'maximize', labelKey: 'sc.maximize' },
  { action: 'minimize', labelKey: 'sc.minimize' },
  { action: 'restore', labelKey: 'sc.restore' },
  { action: 'close', labelKey: 'sc.close' },
  { action: 'snapLeft', labelKey: 'sc.snapLeft' },
  { action: 'snapRight', labelKey: 'sc.snapRight' },
];

/** A binding config: one key token per action. */
export type ShortcutConfig = Record<ShortcutAction, string>;

// Defaults: transport on Space + arrow keys (as requested), the rest on mnemonics.
export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  playPause: 'Space',
  prev: 'ArrowLeft',
  next: 'ArrowRight',
  shuffle: 's',
  repeat: 'r',
  mute: 'm',
  visualizer: 'v',
  theme: 't',
  help: '?',
  maximize: 'ArrowUp',
  minimize: 'ArrowDown',
  restore: 'Insert',
  close: 'Delete',
  // Split-screen: snap the focused window to the left / right half.
  snapLeft: '[',
  snapRight: ']',
};

/** Merge a (possibly partial / older-schema) stored config over the defaults so
 *  a newly added action always has a binding. */
export function normalizeConfig(stored: Partial<ShortcutConfig> | null | undefined): ShortcutConfig {
  return { ...DEFAULT_SHORTCUTS, ...(stored ?? {}) };
}

/**
 * Normalize a keydown into a stable token: 'Space', single chars lowercased
 * ('n', '?'), named keys kept ('ArrowLeft'). Modifier state is ignored — these
 * are bare-key shortcuts. `code === 'Space'` is checked too because with some
 * layouts `key` for the space bar isn't a plain ' '.
 */
export function eventToToken(e: { key: string; code?: string }): string {
  if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') return 'Space';
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

const DISPLAY: Record<string, string> = {
  Space: 'SPACE',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'ESC',
  Enter: '⏎',
};

/** Human-facing label for a token (used on the rebind buttons and the manual). */
export function displayToken(token: string): string {
  return DISPLAY[token] ?? token.toUpperCase();
}

/** Which action a pressed token triggers, or null if unbound. */
export function matchAction(config: ShortcutConfig, token: string): ShortcutAction | null {
  for (const action of Object.keys(config) as ShortcutAction[]) {
    if (config[action] === token) return action;
  }
  return null;
}

/**
 * Bind `action` to `token`. If another action already owns that token, the two
 * swap keys — this keeps every action bound and every token unique (no dead keys,
 * no two actions firing on one press).
 */
export function withBinding(config: ShortcutConfig, action: ShortcutAction, token: string): ShortcutConfig {
  if (config[action] === token) return config;
  const next: ShortcutConfig = { ...config };
  const previousOwner = (Object.keys(config) as ShortcutAction[]).find((a) => config[a] === token);
  const oldToken = config[action];
  next[action] = token;
  if (previousOwner && previousOwner !== action) next[previousOwner] = oldToken;
  return next;
}
