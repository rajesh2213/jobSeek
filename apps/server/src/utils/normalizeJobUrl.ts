/**
 * Single canonical form for job URL identity: Redis `job:seen:*`, DB `sourceUrl` unique, dedup logs.
 * - lowercases host and path
 * - strips non-identity query params and hash
 * - preserves ATS job-id query params (e.g. Greenhouse `gh_jid`)
 * - collapses multiple slashes in the path
 * - trims a trailing slash (except root-only paths are normalized to origin without trailing slash)
 */

/** Query params that encode per-job identity on shared listing pages (must survive normalization). */
const IDENTITY_QUERY_PARAMS = ["gh_jid"] as const;

function pickIdentitySearchParams(searchParams: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of IDENTITY_QUERY_PARAMS) {
    const value = searchParams.get(key);
    if (value != null && value.trim() !== "") {
      kept.set(key, value.trim());
    }
  }
  const s = kept.toString();
  return s ? `?${s}` : "";
}

function extractGhJidFromHeuristic(url: string): string | null {
  const m = url.match(/[?&]gh_jid=([^&#]+)/i);
  return m?.[1]?.trim() ?? null;
}

export function normalizeJobUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    const identitySearch = pickIdentitySearchParams(u.searchParams);
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+/g, "/");
    let out = u.toString().toLowerCase();
    if (out.endsWith("/")) {
      out = out.slice(0, -1);
    }
    return out + identitySearch;
  } catch {
    return normalizeJobUrlHeuristic(trimmed);
  }
}

function normalizeJobUrlHeuristic(s: string): string {
  let t = s.toLowerCase();
  const ghJid = extractGhJidFromHeuristic(t);
  const q = t.indexOf("?");
  if (q >= 0) t = t.slice(0, q);
  const h = t.indexOf("#");
  if (h >= 0) t = t.slice(0, h);
  t = t.replace(/\/+/g, "/");
  if (t.length > 1 && t.endsWith("/")) t = t.slice(0, -1);
  if (ghJid) return `${t}?gh_jid=${ghJid}`;
  return t;
}
