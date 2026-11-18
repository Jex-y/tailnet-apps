import { type RefObject, useEffect } from "react";

/**
 * Publishes the dock's height as `--dock-height`, so the page leaves room under it, and how far the system keyboard
 * reaches up the screen as `--keyboard-inset`, so the dock rides above the keyboard rather than behind it.
 */
export const useDockPlacement = (dock: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const element = dock.current;
    if (element === null) {
      return;
    }
    const root = document.documentElement.style;
    const measure = new ResizeObserver(() => root.setProperty("--dock-height", `${element.offsetHeight}px`));
    measure.observe(element);

    // The keyboard shrinks the visual viewport, not the layout viewport that fixed elements sit in.
    const viewport = window.visualViewport;
    const place = () => {
      if (viewport !== null) {
        const inset = window.innerHeight - viewport.height - viewport.offsetTop;
        root.setProperty("--keyboard-inset", `${Math.max(0, Math.round(inset))}px`);
      }
    };
    place();
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);

    return () => {
      measure.disconnect();
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
      root.removeProperty("--dock-height");
      root.removeProperty("--keyboard-inset");
    };
  }, [dock]);
};
