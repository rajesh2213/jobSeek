/**
 * Absolute URLs and shared Open Graph defaults for SEO.
 */

export function getSiteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  const base = getSiteBaseUrl();
  if (!path || path === "/") return base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
