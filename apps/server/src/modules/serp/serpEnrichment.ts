/** Pure URL-based enrichment for SERP results (no network). */

const IGNORED_FIRST_SEGMENTS = new Set(["jobs", "careers", "positions"]);

function parseUrlSafe(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * First pathname segment, unless it is a generic board segment (jobs/careers/positions).
 */
function firstMeaningfulPathSegment(pathname: string): string | null {
  const segs = pathname.split("/").filter(Boolean);
  if (!segs.length) return null;
  const first = segs[0];
  if (!first) return null;
  if (IGNORED_FIRST_SEGMENTS.has(first.toLowerCase())) return null;
  return first;
}

function isWdClusterLabel(label: string): boolean {
  const s = label.toLowerCase();
  if (s.length < 3 || s[0] !== "w" || s[1] !== "d") return false;
  for (let i = 2; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Workday tenant slug: label immediately before "myworkdayjobs", unless that label is wdN (e.g. wd5),
 * in which case use the label to its left (acme.wd5.myworkdayjobs.com → acme).
 */
function extractWorkdayTenantSlug(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (!host.endsWith(".myworkdayjobs.com")) return null;

  const parts = host.split(".");
  const idx = parts.findIndex((p) => p.includes("myworkdayjobs"));
  if (idx <= 0) return null;

  let left = parts[idx - 1];
  if (left && isWdClusterLabel(left) && idx >= 2) {
    left = parts[idx - 2];
  }
  return left || null;
}

/**
 * Infer canonical ATS type from hostname (e.g. boards.greenhouse.io → greenhouse).
 */
export function inferAtsType(domain: string): string | null {
  const d = domain.trim().toLowerCase();
  if (!d) return null;

  if (d.includes("myworkdayjobs")) return "workday";
  if (d === "boards.greenhouse.io" || d.endsWith(".boards.greenhouse.io")) return "greenhouse";
  if (d === "jobs.lever.co" || d.endsWith(".lever.co")) return "lever";
  if (d === "jobs.ashbyhq.com" || d.includes("ashbyhq")) return "ashby";
  if (d.includes("workable")) return "workable";
  if (d.includes("smartrecruiters")) return "smartrecruiters";
  if (d.includes("bamboohr")) return "bamboohr";
  if (d.includes("teamtailor")) return "teamtailor";
  if (d.includes("rippling")) return "rippling";
  if (d.includes("jobvite")) return "jobvite";
  if (d.includes("icims")) return "icims";

  return null;
}

/**
 * Best-effort company/board slug for known ATS URL shapes.
 */
export function extractCompanySlug(url: string, atsType: string | null): string | null {
  const u = parseUrlSafe(url);
  if (!u || !atsType) return null;

  const host = u.hostname.toLowerCase();

  if (atsType === "workday") {
    return extractWorkdayTenantSlug(host);
  }

  const pathSlug = firstMeaningfulPathSegment(u.pathname);

  switch (atsType) {
    case "greenhouse":
      return host === "boards.greenhouse.io" ? pathSlug : null;
    case "lever":
      return host === "jobs.lever.co" ? pathSlug : null;
    case "ashby":
      return host === "jobs.ashbyhq.com" ? pathSlug : null;
    case "jobvite":
      return host === "jobs.jobvite.com" ? pathSlug : null;
    case "icims":
      return host === "icims.com" || host.endsWith(".icims.com") ? pathSlug : null;
    default:
      return null;
  }
}

/**
 * Priority score for Phase 4 ranking (higher = stronger ATS board signal).
 */
export function getAtsSignalScore(atsType: string | null): number {
  if (!atsType) return 3;

  switch (atsType) {
    case "greenhouse":
    case "lever":
      return 10;
    case "workday":
    case "ashby":
      return 9;
    case "jobvite":
      return 8;
    case "icims":
    case "smartrecruiters":
    case "workable":
      return 7;
    case "bamboohr":
    case "teamtailor":
    case "rippling":
      return 6;
    default:
      return 3;
  }
}
