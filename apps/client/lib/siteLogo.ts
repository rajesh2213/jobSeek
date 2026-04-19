/** Primary JobLoom logo (retro wordmark + mark) — served from `/public/brand`. */
export const SITE_LOGO_PRIM_SRC = "/brand/jobloom-logo-prim.png";

/** Trimmed / scaled export for footer — reads larger than raw prim at the same CSS size. */
export const SITE_LOGO_UI_SRC = "/brand/jobloom-logo-ui.png";

/** Intrinsic dimensions for `next/image` in footer (height drives layout). */
export const SITE_LOGO_FOOTER = { width: 220, height: 52 } as const;
