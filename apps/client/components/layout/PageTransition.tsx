"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Subtle fade-in on route changes without unmounting children.
 *
 * Unlike AnimatePresence + key={pathname} (which force-unmounts and
 * remounts the entire page tree, destroying state and blocking with
 * exit animations), this uses a plain CSS animation re-trigger:
 *   1. Remove the animation class (resets the animation)
 *   2. Force reflow so the browser notices the removal
 *   3. Re-add the class to play the fade-in
 *
 * First render shows content immediately (no animation).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("page-enter");
    void el.offsetHeight;
    el.classList.add("page-enter");
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
