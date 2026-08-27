import React from 'react';

/**
 * Live pixel width of an element, via ResizeObserver.
 *
 * Windows here are resized/maximized by the window manager, not by the browser
 * viewport, so CSS media queries (and Tailwind's `lg:`) describe the SCREEN and
 * say nothing about how much room a panel actually has. Anything that should
 * adapt to its own window has to measure itself.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Seed synchronously so the first paint isn't the wrong variant.
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
