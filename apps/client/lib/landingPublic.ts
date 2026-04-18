/**
 * Build-time public env for the marketing landing page.
 * Set in `.env` / deployment (see root `.env.example`).
 */

/** Hero “Jobs indexed” total; default 2_300_000. */
export const HERO_JOB_INDEX_TOTAL = (() => {
  const raw =
    typeof process.env.NEXT_PUBLIC_LANDING_HERO_JOB_COUNT === "string"
      ? process.env.NEXT_PUBLIC_LANDING_HERO_JOB_COUNT.trim()
      : "";
  const parsed = raw ? Number.parseInt(raw, 10) : 2_300_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_300_000;
})();

/** Scrolling testimonial section — enable after MoR / legal readiness. */
export const SHOW_LANDING_TESTIMONIALS =
  process.env.NEXT_PUBLIC_SHOW_LANDING_TESTIMONIALS === "true";
