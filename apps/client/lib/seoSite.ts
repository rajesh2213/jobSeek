/**
 * Absolute URLs and shared Open Graph defaults for SEO.
 */

const LOCAL_FALLBACK = "http://localhost:3001";

function normalizeToAbsoluteUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = t.includes("://") ? t : `https://${t}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getSiteBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv != null) {
    const n = normalizeToAbsoluteUrl(fromEnv);
    if (n) return n;
  }
  return normalizeToAbsoluteUrl(LOCAL_FALLBACK) ?? LOCAL_FALLBACK;
}

export function absoluteUrl(path: string): string {
  const base = getSiteBaseUrl();
  if (!path || path === "/") return base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
