import { extractBoardCandidateUrls } from "./extractBoardUrls.js";
import { INVALID_WORKDAY_SITES } from "./atsTokenValidation.js";

export interface WorkdayToken {
  host: string;
  tenant: string;
  site: string;
}

function isValidWorkdaySite(site: string): boolean {
  const s = site.trim().toLowerCase();
  if (!s || INVALID_WORKDAY_SITES.has(s)) return false;
  return true;
}

function parseWorkdayUrl(value: string): WorkdayToken | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!host.includes("myworkdayjobs.com")) return null;
    const tenant = host.split(".")[0];
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (!tenant || pathParts.length === 0) return null;

    const firstSeg = pathParts[0]!.toLowerCase();
    if (firstSeg === "job" && pathParts.length >= 2) {
      const site = pathParts[1] === "login" ? null : "Careers";
      if (!site) return null;
      return { host, tenant, site };
    }

    if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(firstSeg) && pathParts.length >= 2) {
      const site = pathParts[1]!;
      if (!isValidWorkdaySite(site)) return null;
      return { host, tenant, site };
    }

    const site = pathParts[pathParts.length - 1]!;
    if (!isValidWorkdaySite(site)) return null;
    return { host, tenant, site };
  } catch {
    return null;
  }
}

function parseWorkdayJsonObject(raw: string): WorkdayToken | null {
  const hostMatch = raw.match(/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)/i);
  if (!hostMatch?.[1]) return null;
  const host = hostMatch[1].toLowerCase();
  const tenant = host.split(".")[0];
  const siteMatch = raw.match(/"(?:site|careerSite|boardId|siteId)"\s*:\s*"([^"]+)"/i);
  const site = siteMatch?.[1] ?? pathPartsFromWdUrl(raw)?.site;
  if (!site || !isValidWorkdaySite(site)) return null;
  return { host, tenant, site };
}

function pathPartsFromWdUrl(blob: string): { site: string } | null {
  const m = blob.match(/myworkdayjobs\.com\/[a-z]{2}(?:-[A-Z]{2})?\/([^/"'\s?#]+)/i);
  if (m?.[1] && isValidWorkdaySite(m[1])) return { site: m[1] };
  const m2 = blob.match(/myworkdayjobs\.com\/([^/"'\s?#]+)(?:\/|$)/i);
  if (m2?.[1] && isValidWorkdaySite(m2[1])) return { site: m2[1] };
  return null;
}

export function extractWorkdayToken(
  html: string | null,
  careersUrl: string | null,
): string | null {
  const candidates = extractBoardCandidateUrls(html, careersUrl);

  for (const candidate of candidates) {
    const parsed = parseWorkdayUrl(candidate);
    if (parsed) return JSON.stringify(parsed);
  }

  const blob = `${html ?? ""}\n${careersUrl ?? ""}`;

  for (const match of blob.matchAll(/https?:\/\/[a-z0-9.-]+\.wd\d+\.myworkdayjobs\.com[^\s"'<>]*/gi)) {
    const parsed = parseWorkdayUrl(match[0]!);
    if (parsed) return JSON.stringify(parsed);
  }

  for (const match of blob.matchAll(/\{[^{}]{0,400}myworkdayjobs\.com[^{}]{0,400}\}/gi)) {
    const parsed = parseWorkdayJsonObject(match[0]!);
    if (parsed) return JSON.stringify(parsed);
  }

  const nextData = blob.match(/__NEXT_DATA__[^>]*>(\{[\s\S]*?\})<\//i);
  if (nextData?.[1]) {
    const parsed = parseWorkdayJsonObject(nextData[1]);
    if (parsed) return JSON.stringify(parsed);
  }

  return null;
}
