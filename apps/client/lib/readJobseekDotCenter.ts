import { siteLogoBrandDotRef } from "./siteLogoBrandDotRef";

export type DotCenter = { x: number; y: number };

/** Viewport center of the JobLoom logo brand dot (getBoundingClientRect), or null if missing / not laid out. */
export function readJobseekDotCenter(): DotCenter | null {
  const dotEl = siteLogoBrandDotRef.current ?? document.getElementById("site-logo-brand-dot");
  if (!dotEl) return null;
  const dr = dotEl.getBoundingClientRect();
  if (dr.width < 1 || dr.height < 1) return null;
  return {
    x: dr.left + dr.width / 2,
    y: dr.top + dr.height / 2,
  };
}
