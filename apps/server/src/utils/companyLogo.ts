import { normalizeDomain } from "./common.js";

const LOGO_PROBE_TIMEOUT_MS = 4000;

const LOGO_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; JobSeek/1.0)",
} as const;

/** Basic hostname: letters, digits, dots, hyphens; no path or port in the string. */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

export type CompanyLogoSource = "clearbit" | "github" | "google";

function sanitizeDomainForLogo(raw: string): string | null {
  const d = normalizeDomain(raw);
  if (!d || d.length > 253) return null;
  if (d.includes("/") || d.includes(":") || d.includes(" ")) return null;
  if (d.startsWith("company:")) return null;
  if (!HOSTNAME_RE.test(d)) return null;
  return d;
}

function googleFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function clearbitLogoUrl(domain: string): string {
  return `https://logo.clearbit.com/${encodeURIComponent(domain)}`;
}

function githubFaviconUrl(domain: string): string {
  return `https://favicons.githubusercontent.com/${encodeURIComponent(domain)}`;
}

/**
 * GET request: validate status + image/* from headers only, cancel body without reading it.
 */
async function probeImageUrl(url: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(LOGO_PROBE_TIMEOUT_MS),
      redirect: "follow",
      headers: { ...LOGO_FETCH_HEADERS },
    });
  } catch {
    return false;
  }

  const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
  const ok = res.ok && ct.startsWith("image/");

  try {
    await res.body?.cancel();
  } catch {
    // ignore cancel errors
  }

  return ok;
}

/**
 * Priority: Clearbit → GitHub favicons → Google s2 favicon (always last).
 * Returns null only when the domain is not usable as a hostname.
 */
export async function resolveCompanyLogoWithSource(
  domain: string,
): Promise<{ url: string; source: CompanyLogoSource } | null> {
  const d = sanitizeDomainForLogo(domain);
  if (!d) return null;

  const clearbit = clearbitLogoUrl(d);
  if (await probeImageUrl(clearbit)) {
    return { url: clearbit, source: "clearbit" };
  }

  const github = githubFaviconUrl(d);
  if (await probeImageUrl(github)) {
    return { url: github, source: "github" };
  }

  return { url: googleFaviconUrl(d), source: "google" };
}

export async function resolveCompanyLogoUrl(domain: string): Promise<string | null> {
  const r = await resolveCompanyLogoWithSource(domain);
  return r?.url ?? null;
}
