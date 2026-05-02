/**
 * Match Chrome extension URL patterns (`host_permissions`, `content_scripts.matches`).
 * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */
export function matchesChromeMatchPattern(urlStr: string, patternStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  const schemeSep = patternStr.indexOf("://");
  if (schemeSep < 0) return false;

  const schemePat = patternStr.slice(0, schemeSep).toLowerCase();
  const afterScheme = patternStr.slice(schemeSep + 3);
  const slashIx = afterScheme.indexOf("/");
  const hostPat = slashIx >= 0 ? afterScheme.slice(0, slashIx) : afterScheme;
  const pathPat = slashIx >= 0 ? afterScheme.slice(slashIx) : "/*";

  const urlScheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (schemePat !== "*" && schemePat !== urlScheme) return false;

  const urlHost = url.hostname.toLowerCase();
  if (!hostMatches(hostPat, urlHost)) return false;

  const urlPath = url.pathname || "/";
  return pathMatches(pathPat, urlPath);
}

function hostMatches(pat: string, host: string): boolean {
  const p = pat.toLowerCase();
  const h = host.toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const rest = p.slice(2);
    return h === rest || h.endsWith(`.${rest}`);
  }
  return p === h;
}

function pathMatches(pat: string, urlPath: string): boolean {
  if (!pat.startsWith("/")) return false;
  const path = urlPath || "/";

  if (pat === "/*") return true;

  if (pat.endsWith("/*")) {
    const base = pat.slice(0, -2);
    if (base === "") return true;
    return path === base || path.startsWith(`${base}/`);
  }

  return path === pat;
}

/** True when `tabUrl` matches any entry in manifest `host_permissions` (MV3). */
export function tabMatchesManifestHostPermissions(tabUrl: string): boolean {
  try {
    const m = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
    const patterns = m.host_permissions ?? [];
    return patterns.some((p) => matchesChromeMatchPattern(tabUrl, p));
  } catch {
    return false;
  }
}
