import type { AtsType } from "../ats/ats.interface.js";
import { CRAWLABLE_ATS_TYPES, isSupportedAtsType } from "../ats/ats.interface.js";
import { normalizeAtsUrl } from "../../utils/normalizeAtsUrl.js";
import {
  isInvalidAtsBoardToken,
  INVALID_WORKDAY_SITES,
} from "../discovery/extractors/atsTokenValidation.js";

export type AtsEndpointParseResult = {
  type: AtsType;
  /** Lowercase, ASCII-only identifier (Workday uses encoded triple segments joined by __). */
  slug: string;
  /** Stable listing/board URL for humans and downstream tooling. */
  baseUrl: string;
  /** Exact string passed to existing ATS `fetchJobs` implementations. */
  crawlToken: string;
};

export interface WorkdayTokenParts {
  host: string;
  tenant: string;
  site: string;
}

const CRAWLABLE = new Set<AtsType>(CRAWLABLE_ATS_TYPES);

export function asciiSafeLower(s: string): string {
  return s
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .trim();
}

function encodeSlugTriple(a: string, b: string, c: string): string {
  const enc = (part: string) =>
    encodeURIComponent(asciiSafeLower(part))
      .replace(/%[A-F0-9]{2}/g, (m) => m.toLowerCase())
      .replace(/[!'()*]/g, (ch) => encodeURIComponent(ch).toLowerCase());

  return `${enc(a)}__${enc(b)}__${enc(c)}`;
}

export function buildWorkdaySlug(parts: WorkdayTokenParts): string {
  return encodeSlugTriple(parts.host, parts.tenant, parts.site);
}

export function parseWorkdaySlug(slug: string): WorkdayTokenParts | null {
  const segments = slug.split("__");
  if (segments.length !== 3) return null;
  try {
    const host = decodeURIComponent(segments[0]!);
    const tenant = decodeURIComponent(segments[1]!);
    const site = decodeURIComponent(segments[2]!);
    if (!host || !tenant || !site) return null;
    return { host, tenant, site };
  } catch {
    return null;
  }
}

function isValidWorkdayToken(t: WorkdayTokenParts | null): t is WorkdayTokenParts {
  if (!t) return false;
  if (!t.host?.trim() || !t.tenant?.trim() || !t.site?.trim()) return false;
  return !INVALID_WORKDAY_SITES.has(t.site.trim().toLowerCase());
}

function parseWorkdayFromUrl(normalizedUrl: string): WorkdayTokenParts | null {
  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase();
    if (!host.includes("myworkdayjobs.com")) return null;
    const tenant = host.split(".")[0]!;
    if (!tenant) return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return null;

    // CXS job posting URLs: /job/{location}/{title}_{id} — last segment is not the board site.
    const firstSeg = pathParts[0]!.toLowerCase();
    if (firstSeg === "job" && pathParts.length >= 3) {
      return { host, tenant, site: "Careers" };
    }

    const site = pathParts[pathParts.length - 1]!;
    if (!site || INVALID_WORKDAY_SITES.has(site.toLowerCase())) return null;
    return { host, tenant, site };
  } catch {
    return null;
  }
}

/** Aligns with `workday.crawler` token parsing (JSON, URL, or host|tenant|site). */
export function parseWorkdayBoardToken(raw: string): WorkdayTokenParts | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<WorkdayTokenParts>;
    if (
      typeof parsed.host === "string" &&
      typeof parsed.tenant === "string" &&
      typeof parsed.site === "string"
    ) {
      return {
        host: parsed.host.trim().toLowerCase(),
        tenant: parsed.tenant.trim(),
        site: parsed.site.trim(),
      };
    }
  } catch {
    /* ignore: not JSON */
  }

  const fromUrl = parseWorkdayFromUrl(normalizeAtsUrl(trimmed) || trimmed);
  if (isValidWorkdayToken(fromUrl)) return fromUrl;

  const parts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    const [host, tenant, site] = parts;
    if (host && tenant && site) {
      return { host: host.toLowerCase(), tenant, site };
    }
  }

  return null;
}

export function detectAtsTypeFromUrl(url: string): AtsType | null {
  const normalized = normalizeAtsUrl(url);
  if (!normalized) return null;
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();

  if (host.includes("myworkdayjobs.com") && CRAWLABLE.has("workday")) return "workday";
  if (host.includes("greenhouse.io") && CRAWLABLE.has("greenhouse")) return "greenhouse";
  if (host.includes("lever.co") && CRAWLABLE.has("lever")) return "lever";
  if (host.includes("ashbyhq.com") && CRAWLABLE.has("ashby")) return "ashby";
  if (host.includes("workable.com") && CRAWLABLE.has("workable")) return "workable";
  if (host.includes("smartrecruiters.com") && CRAWLABLE.has("smartrecruiters"))
    return "smartrecruiters";
  if (host.includes("bamboohr.com") && CRAWLABLE.has("bamboohr")) return "bamboohr";
  if (host.includes("teamtailor.com") && CRAWLABLE.has("teamtailor")) return "teamtailor";
  if (host.includes("rippling.com") && CRAWLABLE.has("rippling")) return "rippling";
  if (host.includes("jobvite.com") && CRAWLABLE.has("jobvite")) return "jobvite";

  return null;
}

export function extractSlug(url: string, type: AtsType): string | null {
  const normalized = normalizeAtsUrl(url);
  if (!normalized || !CRAWLABLE.has(type)) return null;

  if (type === "workday") {
    const w = parseWorkdayFromUrl(normalized);
    if (!isValidWorkdayToken(w)) return null;
    return buildWorkdaySlug(w);
  }

  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (type === "greenhouse" && host.includes("greenhouse.io")) {
    if (parts[0] === "embed" && parts[1] === "job_board") {
      const q = u.searchParams.get("for");
      if (q?.trim() && !isInvalidAtsBoardToken(q)) return asciiSafeLower(q.trim());
    }
    if (parts[0] === "boards" && parts[1] && !isInvalidAtsBoardToken(parts[1])) {
      return asciiSafeLower(parts[1]!);
    }
    if (
      parts.length >= 1 &&
      (host.startsWith("boards.") || host.startsWith("job-boards.")) &&
      !isInvalidAtsBoardToken(parts[0])
    ) {
      return asciiSafeLower(parts[0]!);
    }
  }
  if (type === "lever" && host.includes("lever.co") && parts[0] === "jobs" && parts[1]) {
    return asciiSafeLower(parts[1]!);
  }
  if (type === "ashby" && host.includes("ashbyhq.com")) {
    if (host === "jobs.ashbyhq.com" && parts[0] && !isInvalidAtsBoardToken(parts[0])) {
      return asciiSafeLower(parts[0]);
    }
    if (parts[0] === "jobs" && parts[1] && !isInvalidAtsBoardToken(parts[1])) {
      return asciiSafeLower(parts[1]!);
    }
    const jbIdx = parts.indexOf("job-board");
    if (jbIdx >= 0 && parts[jbIdx + 1] && !isInvalidAtsBoardToken(parts[jbIdx + 1])) {
      return asciiSafeLower(parts[jbIdx + 1]!);
    }
  }
  if (type === "workable" && host.includes("workable.com")) {
    const idx = parts.findIndex((p) => p === "accounts" || p === "jobs");
    if (idx >= 0 && parts[idx + 1]) return asciiSafeLower(parts[idx + 1]!);
    if (parts[0] === "api" && parts[1] === "accounts" && parts[3] === "jobs" && parts[2]) {
      return asciiSafeLower(parts[2]!);
    }
  }
  if (type === "smartrecruiters" && host.includes("smartrecruiters.com")) {
    const cidx = parts.indexOf("company");
    if (cidx >= 0 && parts[cidx + 1]) return asciiSafeLower(parts[cidx + 1]!);
    if (parts[0] === "company" && parts[1]) return asciiSafeLower(parts[1]!);
  }
  if (type === "bamboohr" && host.includes("bamboohr.com")) {
    const sub = host.replace(/\.bamboohr\.com$/i, "");
    if (sub && !sub.includes(".")) return asciiSafeLower(sub);
  }
  if (type === "teamtailor" && host.includes("teamtailor.com")) {
    const sub = host.replace(/\.teamtailor\.com$/i, "");
    if (sub && !sub.includes(".")) return asciiSafeLower(sub);
  }
  if (type === "rippling" && host.includes("rippling.com")) {
    const j = parts.indexOf("jobs");
    if (parts[0] === "ats" && j === 2 && parts[1]) return asciiSafeLower(parts[1]!);
    if (parts[0] === "ats" && parts[1]) return asciiSafeLower(parts[1]!);
  }
  if (type === "jobvite" && host.includes("jobvite.com")) {
    if (parts[0] === "jobs" && parts[1]) return asciiSafeLower(parts[1]!);
    if (parts[0]) return asciiSafeLower(parts[0]!);
  }

  return null;
}

export function buildBaseUrl(type: AtsType, slug: string): string {
  if (type === "workday") {
    const w = parseWorkdaySlug(slug);
    if (!w) return "";
    return `https://${w.host}/wday/cxs/${encodeURIComponent(w.tenant)}/${encodeURIComponent(w.site)}/jobs`;
  }
  const id = slug;
  switch (type) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${id}`;
    case "lever":
      return `https://jobs.lever.co/${id}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${id}`;
    case "workable":
      return `https://apply.workable.com/${id}`;
    case "smartrecruiters":
      return `https://careers.smartrecruiters.com/${id}`;
    case "bamboohr":
      return `https://${id}.bamboohr.com/careers`;
    case "teamtailor":
      return `https://${id}.teamtailor.com/jobs`;
    case "rippling":
      return `https://ats.rippling.com/${id}/jobs`;
    case "jobvite":
      return `https://jobs.jobvite.com/${id}`;
    default:
      return "";
  }
}

/**
 * Full parse from a normalized careers/job URL only.
 */
export function parseAtsUrlToEndpoint(url: string): AtsEndpointParseResult | null {
  const normalized = normalizeAtsUrl(url);
  if (!normalized) return null;
  const type = detectAtsTypeFromUrl(normalized);
  if (!type) return null;
  if (type === "workday") {
    const w = parseWorkdayFromUrl(normalized);
    if (!isValidWorkdayToken(w)) return null;
    const slug = buildWorkdaySlug(w);
    return {
      type: "workday",
      slug,
      baseUrl: `https://${w.host}/wday/cxs/${w.tenant}/${w.site}/jobs`,
      crawlToken: JSON.stringify(w),
    };
  }
  const slug = extractSlug(normalized, type);
  if (!slug) return null;
  const crawlToken =
    type === "greenhouse" && slug
      ? slug
      : type === "lever"
        ? slug
        : type === "ashby"
          ? slug
          : slug;
  return {
    type,
    slug,
    baseUrl: buildBaseUrl(type, slug),
    crawlToken,
  };
}

/** Resolve slug + token when the board token is known (enrichment path). */
export function parseCrawlableBoard(
  type: AtsType,
  boardToken: string,
  sourceUrl?: string | null,
): AtsEndpointParseResult | null {
  const token = boardToken.trim();
  if (!token || !isSupportedAtsType(type) || !CRAWLABLE.has(type)) return null;

  if (/^https?:\/\//i.test(token)) {
    const parsedUrl = parseAtsUrlToEndpoint(token);
    if (parsedUrl && parsedUrl.type === type) return parsedUrl;
  }

  if (type === "workday") {
    const w = parseWorkdayBoardToken(token);
    if (!isValidWorkdayToken(w)) return null;
    const slug = buildWorkdaySlug(w);
    const baseUrl = `https://${w.host}/wday/cxs/${w.tenant}/${w.site}/jobs`;
    return { type: "workday", slug, baseUrl, crawlToken: JSON.stringify(w) };
  }

  const fromUrl =
    sourceUrl && sourceUrl.trim()
      ? extractSlug(sourceUrl.trim(), type)
      : null;
  const rawFallback = asciiSafeLower(token.split(/[/\s]+/g).pop() ?? token);
  const slug = fromUrl ?? (isInvalidAtsBoardToken(rawFallback) ? null : rawFallback);
  if (!slug) return null;

  return {
    type,
    slug,
    baseUrl: buildBaseUrl(type, slug),
    crawlToken: token,
  };
}
