import type { JobloomAttributionPayload } from "./types";

const STORAGE_KEY = "jobloom_attr_v1";
const COOKIE_NAME = "jl_attr";
const COOKIE_MAX_AGE_SEC = 180 * 24 * 60 * 60; // 180 days

function readParamsFromUrl(): JobloomAttributionPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const keys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
    ] as const;
    const out: JobloomAttributionPayload = {};
    let any = false;
    for (const k of keys) {
      const v = url.searchParams.get(k)?.trim();
      if (v) {
        out[k] = v.slice(0, 512);
        any = true;
      }
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

function loadStored(): JobloomAttributionPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return null;
    return j as JobloomAttributionPayload;
  } catch {
    return null;
  }
}

function persistStored(attr: JobloomAttributionPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attr));
  } catch {
    /* ignore */
  }
}

/** Sync first-touch attribution to cookie so Fastify routes can read it on API calls. */
function syncCookie(attr: JobloomAttributionPayload): void {
  if (typeof window === "undefined") return;
  try {
    const payload = encodeURIComponent(JSON.stringify(attr));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NAME}=${payload}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

/**
 * Call once on app load: capture UTMs from the landing URL, merge with any prior session storage,
 * persist for later API calls and Meta custom_data (via /analytics/meta/sync).
 */
export function captureAndPersistAttribution(): JobloomAttributionPayload | null {
  const fromUrl = readParamsFromUrl();
  const prev = loadStored();
  const merged: JobloomAttributionPayload = { ...prev, ...fromUrl };
  const has = Object.values(merged).some((v) => Boolean(v && String(v).trim()));
  if (!has) return prev;
  persistStored(merged);
  syncCookie(merged);
  return merged;
}

export function getPersistedAttribution(): JobloomAttributionPayload | null {
  return loadStored();
}
