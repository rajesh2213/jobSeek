import type { AtsType } from "../../ats/ats.interface.js";

/** Canonical https homepage URL for a hostname (no path). */
export function homepageUrlForDomain(domain: string): string {
  const d = domain.trim().replace(/^www\./i, "");
  return `https://${d}`;
}

type DetectableAtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "jobvite"
  | "bamboohr"
  | "workday";

/** Match ATS hosts in HTML, links, scripts, iframes (tighten workday to reduce false positives). */
export const ATS_PATTERNS: Array<{ type: DetectableAtsType; regex: RegExp }> = [
  { type: "greenhouse", regex: /(?:boards\.)?greenhouse\.io/i },
  { type: "lever", regex: /jobs\.lever\.co|lever\.co/i },
  { type: "ashby", regex: /jobs\.ashbyhq\.com|ashbyhq\.com/i },
  { type: "workable", regex: /apply\.workable\.com|workable\.com/i },
  { type: "smartrecruiters", regex: /(?:careers\.)?smartrecruiters\.com/i },
  { type: "jobvite", regex: /jobvite\.com/i },
  { type: "bamboohr", regex: /bamboohr\.com/i },
  {
    type: "workday",
    regex: /myworkdayjobs\.com|wd\d+\.myworkdayjobs\.com|workday\.com\/.*career/i,
  },
];

/** Links on <a> tags whose preceding text suggests jobs/apply CTAs (footer/nav). */
const CTA_LOOKBACK = 420;
const CTA_PATTERN =
  /(?:apply\s+now|apply|join\s+us|view\s+jobs|open\s+roles|we\s*(?:'|’)?re\s+hiring|careers|jobs|work\s+with\s+us)/i;

export function extractLinksNearJobKeywords(html: string, baseUrl?: string | null): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const idx = m.index ?? 0;
    const lookback = html.slice(Math.max(0, idx - CTA_LOOKBACK), idx);
    if (!CTA_PATTERN.test(lookback)) continue;
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(raw, baseUrl);
    if (normalized) out.add(normalized);
  }
  return Array.from(out);
}

export function extractLinks(html: string, baseUrl?: string | null): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(raw, baseUrl);
    if (normalized) out.add(normalized);
  }
  return Array.from(out);
}

function extractTagSrcUrls(html: string, tagName: "script" | "iframe", baseUrl?: string | null): string[] {
  const out = new Set<string>();
  const re = new RegExp(`<${tagName}\\b[^>]*\\bsrc\\s*=\\s*["']([^"']+)["'][^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(raw, baseUrl);
    if (normalized) out.add(normalized);
  }
  return Array.from(out);
}

function normalizeUrl(raw: string, baseUrl?: string | null): string | null {
  try {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("//")) return `https:${raw}`;
    if (baseUrl?.trim()) {
      return new URL(raw, baseUrl).toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function extractAtsToken(url: string, atsType: string): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);

    if (atsType === "greenhouse" && host.includes("greenhouse.io")) {
      if (parts[0] === "embed" && parts[1] === "job_board") {
        const q = u.searchParams.get("for");
        if (q?.trim()) return q.trim();
      }
      if (parts[0] === "boards" && parts[1]) return parts[1]!;
      if (parts.length >= 1 && host.startsWith("boards.")) {
        return parts[0]!;
      }
    }
    if (atsType === "lever" && host.includes("lever.co") && parts[0] === "jobs" && parts[1]) {
      return parts[1]!;
    }
    if (atsType === "ashby" && host.includes("ashbyhq.com") && parts[0] === "jobs" && parts[1]) {
      return parts[1]!;
    }

    if (atsType === "jobvite" && host.includes("jobvite.com")) {
      // Common shapes:
      // - https://jobs.jobvite.com/<company>/...
      // - https://jobs.jobvite.com/jobs/<company>/...
      if (parts.length >= 2 && parts[0] === "jobs") return parts[1]!;
      if (parts[0]) return parts[0]!;
    }
  } catch {
    return null;
  }
  return null;
}

export function detectATS(input: {
  html: string;
  links?: string[];
  baseUrl?: string | null;
}): { type: AtsType | null; token: string | null } {
  const html = input.html || "";
  const baseUrl = input.baseUrl;
  const directLinks = input.links ?? extractLinks(html, baseUrl);
  const keywordLinks = extractLinksNearJobKeywords(html, baseUrl);
  const mergedLinks = Array.from(new Set([...directLinks, ...keywordLinks]));
  const links = mergedLinks;
  const scriptSrcs = extractTagSrcUrls(html, "script", baseUrl);
  const iframeSrcs = extractTagSrcUrls(html, "iframe", baseUrl);
  const sources = [...links, ...scriptSrcs, ...iframeSrcs];

  for (const pattern of ATS_PATTERNS) {
    if (pattern.regex.test(html)) {
      const fromSource = sources.find((u) => pattern.regex.test(u));
      return {
        type: pattern.type as AtsType,
        token: fromSource ? extractAtsToken(fromSource, pattern.type) : null,
      };
    }
  }

  for (const pattern of ATS_PATTERNS) {
    const fromSource = sources.find((u) => pattern.regex.test(u));
    if (fromSource) {
      return {
        type: pattern.type as AtsType,
        token: extractAtsToken(fromSource, pattern.type),
      };
    }
  }

  return { type: null, token: null };
}

export function detectAtsType(html: string | null): AtsType | null {
  if (!html) return null;
  return detectATS({ html }).type;
}
