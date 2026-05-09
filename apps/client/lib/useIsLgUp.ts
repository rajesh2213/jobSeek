"use client";

import { useEffect, useState } from "react";

const LG_QUERY = "(min-width: 1024px)";

/**
 * True when viewport is Tailwind `lg` and up. Initializes false for SSR/hydration match,
 * then syncs from `matchMedia` (desktop users may see one paint of mobile-only UI).
 */
export function useIsLgUp(): boolean {
  const [isLg, setIsLg] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY);
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return isLg;
}
