import React from 'react';
import { extractBrutalTheme } from '../utils/theme';
import { readableOn } from '../utils/contrast';

/**
 * Drives the brutalist CSS custom properties on <html>. When `dynamicTheme` is
 * on and the current track has cover art, the palette is sampled from the art;
 * otherwise it falls back to a manual accent (or the CSS defaults). The
 * on-accent foreground is always derived from whatever the accent resolves to,
 * so text drawn on it stays legible. Pure side effect — returns nothing.
 */
export function useDynamicTheme(
  coverUrl: string | undefined,
  theme: 'dark' | 'light',
  dynamicTheme: boolean,
  accentColor: string | null,
) {
  React.useEffect(() => {
    const root = document.documentElement;
    const setProp = (name: string, value: string) => {
      if (root.style.getPropertyValue(name) !== value) {
        root.style.setProperty(name, value);
      }
    };
    const removeProp = (name: string) => {
      if (root.style.getPropertyValue(name)) {
        root.style.removeProperty(name);
      }
    };

    const allProps = ['--brutal-black', '--brutal-white', '--brutal-neon', '--brutal-accent', '--brutal-shadow-color', '--brutal-shadow-color-inv'];
    // Derive the on-accent foreground from whatever the accent currently resolves
    // to (manual, dynamic, or the CSS default), so text/icons drawn ON the accent
    // stay legible whatever the accent is. Read the computed value so the default
    // (removeProp) path is covered too.
    const syncOnAccent = () => {
      const accent = getComputedStyle(root).getPropertyValue('--brutal-accent').trim();
      setProp('--brutal-on-accent', readableOn(accent || '#C1272D'));
    };
    const applyManualAccent = () => {
      allProps.forEach(removeProp);
      if (accentColor) {
        setProp('--brutal-neon', accentColor);
        setProp('--brutal-accent', accentColor);
      }
      syncOnAccent();
    };

    if (dynamicTheme && coverUrl) {
      extractBrutalTheme(coverUrl, theme === 'light').then(themeColors => {
        if (themeColors) {
          setProp('--brutal-black', themeColors.brutalBlack);
          setProp('--brutal-white', themeColors.brutalWhite);
          setProp('--brutal-neon', themeColors.brutalNeon);
          setProp('--brutal-accent', themeColors.brutalNeon);
          setProp('--brutal-shadow-color', themeColors.brutalWhite);
          setProp('--brutal-shadow-color-inv', themeColors.brutalBlack);
          syncOnAccent();
        } else {
          applyManualAccent();
        }
      });
    } else {
      applyManualAccent();
    }
  }, [coverUrl, theme, dynamicTheme, accentColor]);
}
