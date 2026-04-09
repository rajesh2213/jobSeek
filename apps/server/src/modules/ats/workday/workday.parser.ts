import { logger } from "../../../utils/logger.js";
import { isValidJobUrl } from "../../../utils/url.js";
import type { NormalizedJob } from "../../crawler/crawler.types.js";
import {
  COUNTRY_NAME_TO_CODE,
  IN_STATES,
  US_STATES,
} from "../../../utils/locationResolver.js";
import {
  inferRemote,
  normalizeLocation as trimAtsLocation,
  sanitizeHtml,
} from "../ats.interface.js";
import type { WorkdayRawJob } from "./workday.types.js";

function toAbsoluteUrl(host: string, pathOrUrl: string): string {
  const p = pathOrUrl.trim();
  if (!p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  const base = host.startsWith("http") ? host : `https://${host}`;
  const baseUrl = new URL(base);
  if (p.startsWith("/")) return `${baseUrl.origin}${p}`;
  return `${baseUrl.origin}/${p.replace(/^\//, "")}`;
}

/**
 * Resolve listing URL from Workday CXS fields using source-of-truth order:
 * externalUrl -> externalPath -> jobPostingUrl -> url.
 */
export function resolveWorkdayListingUrl(
  host: string,
  job: WorkdayRawJob["job"],
): string | null {
  const j = job as Record<string, unknown>;
  const candidates = [
    j.externalUrl,
    j.externalPath,
    j.jobPostingUrl,
    (j as { url?: string }).url,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  for (const raw of candidates) {
    const abs = toAbsoluteUrl(host, raw);
    if (isValidJobUrl(abs)) return abs;
  }
  return null;
}

/**
 * Apply URL priority:
 * 1) `externalUrl` as-is
 * 2) host + `externalPath`
 * 3) `jobPostingUrl`
 * 4) listing URL fallback
 */
export function resolveWorkdayApplyUrl(
  host: string,
  job: WorkdayRawJob["job"],
  listingUrl: string | null,
): string | null {
  const j = job as Record<string, unknown>;

  const externalRaw = typeof j.externalUrl === "string" ? j.externalUrl.trim() : "";
  if (externalRaw) {
    const abs = toAbsoluteUrl(host, externalRaw);
    if (isValidJobUrl(abs)) return abs;
  }

  const externalPathRaw = typeof j.externalPath === "string" ? j.externalPath.trim() : "";
  if (externalPathRaw) {
    const abs = toAbsoluteUrl(host, externalPathRaw);
    if (isValidJobUrl(abs)) return abs;
  }

  const postingRaw = typeof j.jobPostingUrl === "string" ? j.jobPostingUrl.trim() : "";
  if (postingRaw) {
    const abs = toAbsoluteUrl(host, postingRaw);
    if (isValidJobUrl(abs)) return abs;
  }
  return listingUrl;
}

function parsePostedAt(job: WorkdayRawJob["job"]): Date | undefined {
  const raw = job.postedOn;
  if (!raw || typeof raw !== "string") return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function extractDescription(job: WorkdayRawJob["job"]): string {
  const j = job as Record<string, unknown>;
  const html =
    typeof j.jobDescriptionHtml === "string"
      ? j.jobDescriptionHtml
      : typeof j.jobDescription === "string"
        ? j.jobDescription
        : "";
  const plain =
    typeof j.jobDescription === "string" && !html
      ? j.jobDescription
      : sanitizeHtml(html) ||
        (typeof j.jobDescription === "string" ? sanitizeHtml(j.jobDescription) : "");
  const t = (plain ?? "").replace(/\s+/g, " ").trim();
  const max = 50_000;
  if (t.length > max) return `${t.slice(0, max - 3)}...`;
  return t;
}

export interface WorkdayLocationParts {
  city: string | null;
  state: string | null;
  rawLocation: string | undefined;
  /** From `Country---City` style URL segments; passed to `formatSlugLocationHint`. */
  slugDisplayLine?: string;
}

function titleCaseLocationPart(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function usStateFullToAbbr(full: string): string | undefined {
  const e = Object.entries(US_STATES).find(([, name]) => name === full);
  return e?.[0];
}

function inStateFullToCode(full: string): string | undefined {
  const e = Object.entries(IN_STATES).find(([, name]) => name === full);
  return e?.[0];
}

/** Parsed `/job/{segment}` slug: city/state when structured, else a free-text hint for `resolveLocation`. */
export interface WorkdayListingSlugParsed {
  city: string | null;
  state: string | null;
  /** e.g. `Dublin, Ireland` when segment is `Ireland---Dublin` (Country---City). */
  displayLine?: string;
}

function titleCaseSegmentWords(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parse Workday listing URL path segment after `/job/`
 * (e.g. `Itasca-IL`, `India---Hyderabad`, `Ireland---Dublin`, `Washington---Seattle`).
 */
export function parseWorkdayListingSlug(listingUrl: string): WorkdayListingSlugParsed {
  try {
    const u = new URL(listingUrl);
    const idx = u.pathname.toLowerCase().indexOf("/job/");
    if (idx === -1) return { city: null, state: null };
    const rest = u.pathname.slice(idx + 5);
    const seg = rest.split("/").find(Boolean);
    if (!seg) return { city: null, state: null };
    const decoded = decodeURIComponent(seg.replace(/\+/g, " "));

    if (decoded.includes("---")) {
      const [left, right] = decoded.split("---", 2).map((x) => x.trim());
      if (left && right) {
        const leftNorm = left.toLowerCase().replace(/-/g, " ");
        const cityPart = titleCaseLocationPart(right.replace(/-/g, " "));

        if (leftNorm === "india") {
          return {
            city: cityPart,
            state: null,
          };
        }

        for (const [, fullName] of Object.entries(US_STATES)) {
          if (fullName.toLowerCase() === leftNorm) {
            return { city: cityPart, state: fullName };
          }
        }

        const iso = COUNTRY_NAME_TO_CODE[leftNorm];
        if (iso) {
          const countryLabel = titleCaseSegmentWords(left.replace(/-/g, " "));
          return {
            city: cityPart,
            state: null,
            displayLine: `${cityPart}, ${countryLabel}`,
          };
        }

        const fallbackLabel = titleCaseSegmentWords(left.replace(/-/g, " "));
        return {
          city: cityPart,
          state: null,
          displayLine: `${cityPart}, ${fallbackLabel}`,
        };
      }
    }

    const m = decoded.match(/^(.+)-([A-Za-z]{2})$/);
    if (m) {
      const cityPart = m[1]!.replace(/-/g, " ").trim();
      const abbr = m[2]!.toUpperCase();
      if (US_STATES[abbr]) {
        return { city: titleCaseLocationPart(cityPart), state: US_STATES[abbr]! };
      }
      if (IN_STATES[abbr]) {
        return { city: titleCaseLocationPart(cityPart), state: IN_STATES[abbr]! };
      }
    }
    return { city: null, state: null };
  } catch {
    return { city: null, state: null };
  }
}

function formatSlugLocationHint(
  city: string | null,
  state: string | null,
  displayLine?: string | null,
): string | undefined {
  if (displayLine?.trim()) return displayLine.trim();
  if (!city) return undefined;
  if (state) {
    const usAbbr = usStateFullToAbbr(state);
    if (usAbbr) return `${city}, ${usAbbr}`;
    const inCode = inStateFullToCode(state);
    if (inCode) return `${city}, ${inCode}`;
    return `${city}, ${state}`;
  }
  return city;
}

export function buildWorkdayLocationParts(
  job: WorkdayRawJob["job"],
  listingUrl: string | null,
): WorkdayLocationParts {
  const text = trimAtsLocation(job.locationsText);
  const fromApi =
    text ||
    (() => {
      const locations = job.locations ?? [];
      const primary = locations[0];
      if (!primary) return undefined;
      const parts = [primary.city, primary.region, primary.country]
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean);
      return parts.length ? parts.join(", ") : undefined;
    })();

  const slug: WorkdayListingSlugParsed = listingUrl
    ? parseWorkdayListingSlug(listingUrl)
    : { city: null, state: null };

  return {
    city: slug.city,
    state: slug.state,
    rawLocation: fromApi,
    slugDisplayLine: slug.displayLine,
  };
}

function buildWorkdayLocationLine(job: WorkdayRawJob["job"], listingUrl: string | null): string | undefined {
  const { city, state, rawLocation, slugDisplayLine } = buildWorkdayLocationParts(
    job,
    listingUrl,
  );
  const slugHint = formatSlugLocationHint(city, state, slugDisplayLine);
  const parts = [rawLocation, slugHint].filter((x): x is string => Boolean(x && x.trim()));
  return parts.length ? parts.join(" | ") : undefined;
}

export function parseWorkdayJob(
  raw: WorkdayRawJob,
  companyId: string,
): NormalizedJob | null {
  const { token, job } = raw;
  const host = token.host;

  const listingUrl = resolveWorkdayListingUrl(host, job);
  const applyUrl = resolveWorkdayApplyUrl(host, job, listingUrl);

  if (!listingUrl) {
    const j = job as Record<string, unknown>;
    const rawHint = [
      j.jobPostingUrl,
      j.externalPath,
      j.externalUrl,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .join(" | ");
    logger.warn(
      {
        event: "invalid_job_url",
        url: rawHint || "(empty)",
        company: companyId,
      },
      "invalid_job_url",
    );
    return null;
  }

  const title = (job.title ?? "").trim() || "Untitled role";
  const description = extractDescription(job);
  const postedAt = parsePostedAt(job);
  const locationLine = buildWorkdayLocationLine(job, listingUrl);
  const isRemote =
    inferRemote(locationLine) || inferRemote(title) || inferRemote(job.locationsText);

  return {
    title,
    description: description || undefined,
    location: locationLine,
    isRemote,
    source: "workday",
    sourceUrl: listingUrl,
    applyUrl: applyUrl ?? listingUrl,
    postedAt,
    companyId,
  };
}

export function parseWorkdayJobs(
  rawJobs: WorkdayRawJob[],
  companyId: string,
): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  for (const raw of rawJobs) {
    const parsed = parseWorkdayJob(raw, companyId);
    if (parsed) out.push(parsed);
  }
  return out;
}
