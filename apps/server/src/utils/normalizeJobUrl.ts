/**
 * Single canonical form for job URL identity: Redis `job:seen:*`, DB `sourceUrl` unique, dedup logs.
 * - lowercases host and path
 * - strips query and hash
 * - collapses multiple slashes in the path
 * - trims a trailing slash (except root-only paths are normalized to origin without trailing slash)
 */
export function normalizeJobUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+/g, "/");
    let out = u.toString().toLowerCase();
    if (out.endsWith("/")) {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    return normalizeJobUrlHeuristic(trimmed);
  }
}

function normalizeJobUrlHeuristic(s: string): string {
  let t = s.toLowerCase();
  const q = t.indexOf("?");
  if (q >= 0) t = t.slice(0, q);
  const h = t.indexOf("#");
  if (h >= 0) t = t.slice(0, h);
  t = t.replace(/\/+/g, "/");
  if (t.length > 1 && t.endsWith("/")) t = t.slice(0, -1);
  return t;
}
