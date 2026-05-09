/**
 * Central gate for marketing/analytics scripts (Meta Pixel, future vendors).
 * Consent: `localStorage.jobloom_analytics` = "0" disables; unset defaults to allowed (opt-out model).
 * Flip to opt-in later by requiring `=== "1"` before loading third-party scripts.
 */

/** localStorage key documented in Privacy Policy — analytics / advertising measurement opt-out. */
export const ANALYTICS_CONSENT_STORAGE_KEY = "jobloom_analytics";

const STORAGE_KEY = ANALYTICS_CONSENT_STORAGE_KEY;

export function getAnalyticsConsentStorage(): "granted" | "denied" | "unset" {
  if (typeof window === "undefined") return "unset";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "0") return "denied";
    if (v === "1") return "granted";
    return "unset";
  } catch {
    return "unset";
  }
}

export function setAnalyticsConsent(allow: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, allow ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = navigator.doNotTrack;
  return dnt === "1" || dnt === "yes";
}

export function isClientAnalyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (isDoNotTrack()) return false;
  const c = getAnalyticsConsentStorage();
  if (c === "denied") return false;
  return true;
}

export function getPublicMetaPixelId(): string | null {
  const id = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  return id || null;
}

/** Pixel loads in production when ID is set; in non-prod require explicit debug flag. */
export function isMetaPixelEnabled(): boolean {
  const id = getPublicMetaPixelId();
  if (!id) return false;
  if (process.env.NODE_ENV === "production") return true;
  return process.env.NEXT_PUBLIC_META_PIXEL_DEBUG?.trim() === "true";
}

export function isMetaAnalyticsVerbose(): boolean {
  return process.env.NEXT_PUBLIC_META_ANALYTICS_DEBUG?.trim() === "true";
}
