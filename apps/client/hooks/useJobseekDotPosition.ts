"use client";

import { useLayoutEffect, useState } from "react";
import {
  readJobseekDotCenter,
  type DotCenter,
} from "../lib/readJobseekDotCenter";
import { siteLogoBrandDotRef } from "../lib/siteLogoBrandDotRef";

/**
 * Live viewport center of the JobSeek logo dot. Updates on resize / dot ResizeObserver only
 * (no scroll) — use for UI that tracks the dot without coupling to full path remeasure.
 */
export function useJobseekDotPosition(): { position: DotCenter | null } {
  const [position, setPosition] = useState<DotCenter | null>(null);

  useLayoutEffect(() => {
    const update = () => setPosition(readJobseekDotCenter());

    update();
    window.addEventListener("resize", update, { passive: true });
    const dot =
      siteLogoBrandDotRef.current ?? document.getElementById("site-logo-brand-dot");
    const ro = new ResizeObserver(update);
    if (dot) ro.observe(dot);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  return { position };
}
