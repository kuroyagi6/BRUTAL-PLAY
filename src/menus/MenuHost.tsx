import React from 'react';
import { useI18n } from '../i18n/LanguageContext';
import { ContextMenu } from './ContextMenu';
import { buildMenu, menuTitle } from './registry';
import type { MenuActions } from './types';
import type { ContextMenuController } from './useContextMenu';

// Rendered once, near the bottom of App. Whatever the controller says was
// right-clicked, this looks up its item list in the registry and renders it.
// New menus never add JSX to App.tsx.
interface MenuHostProps {
  menu: ContextMenuController;
  actions: MenuActions;
}

export const MenuHost: React.FC<MenuHostProps> = ({ menu, actions }) => {
  const { lang } = useI18n();
  const { state, close } = menu;
  if (!state) return null;

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      title={menuTitle(state.target, lang)}
      items={buildMenu(state.target, actions)}
      onClose={close}
    />
  );
};
