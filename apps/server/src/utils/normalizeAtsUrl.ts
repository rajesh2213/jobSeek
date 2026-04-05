/**
 * Canonical URL for ATS detection / slug extraction: https, lowercase host, no query, no fragment,
 * percent-decoded path (idempotent), no trailing slash except bare origin stays without path.
 */
export function normalizePathnameIdempotent(pathname: string): string {
  let p = pathname || "/";
  for (let i = 0; i < 8; i++) {
    try {
      const decoded = decodeURIComponent(p);
      if (decoded === p) break;
      p = decoded;
    } catch {
      break;
    }
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  if (!p.startsWith("/")) p = `/${p}`;
  return p;
}

export function normalizeAtsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let urlStr = trimmed;
  if (!/^[a-zA-Z][a-zA-Z+.-]*:/.test(urlStr)) {
    urlStr = `https://${urlStr}`;
  }

  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return trimmed;
  }

  const protocol = "https:";
  const host = u.hostname.toLowerCase();
  let path = normalizePathnameIdempotent(u.pathname || "/");
  const pathOut = path === "/" ? "" : path;

  return `${protocol}//${host}${pathOut}`;
}
