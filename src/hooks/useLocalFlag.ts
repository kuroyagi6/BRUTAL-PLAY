// A boolean opt-in backed by localStorage and kept in sync across every
// component that reads it (a Settings toggle and the view it gates, typically)
// via a custom event — so it needs no prop threading through App.
//
// Extracted from useOnlineArtist, which was the first of these. Each online
// feature gets its own flag, defaulting OFF: turning one on means data leaves
// the machine, which is the user's call to make.
import { useEffect, useState, useCallback } from 'react';

export type Flag = [boolean, (v: boolean) => void];

/**
 * `key` is a localStorage key and is PERSISTED USER STATE — changing an existing
 * one silently resets that opt-in back to off for everyone who had set it.
 *
 * `defaultOn` flips the value used when the key has NEVER been written. It is
 * only for flags that refine a switch the user already threw (auto-fetch under
 * online lyrics, say) — never for one that starts data leaving the machine,
 * which must always default off. An explicit '0' still wins over it, so turning
 * such a flag off sticks.
 */
export function makeFlagHook(key: string, defaultOn = false): () => Flag {
  const event = `${key}-changed`;

  const read = (): boolean => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultOn;
      return raw === '1';
    } catch {
      return defaultOn;
    }
  };

  return function useFlag(): Flag {
    const [enabled, setEnabled] = useState<boolean>(read);

    useEffect(() => {
      const sync = () => setEnabled(read());
      window.addEventListener(event, sync);
      window.addEventListener('storage', sync); // other windows/tabs
      return () => {
        window.removeEventListener(event, sync);
        window.removeEventListener('storage', sync);
      };
    }, []);

    const set = useCallback((v: boolean) => {
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* ignore quota/denied */
      }
      setEnabled(v);
      window.dispatchEvent(new Event(event));
    }, []);

    return [enabled, set];
  };
}
