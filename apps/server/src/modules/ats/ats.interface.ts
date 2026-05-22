import type { NormalizedJob } from "../crawler/crawler.types.js";
import {
  DEFAULT_ATS_FETCH_RETRY,
  fetchWithRetry,
} from "../../utils/fetchWithRetry.js";

/**
 * Location on `NormalizedJob`:
 * - Most ATS parsers set a single free-text `location` line; structured ISO + city/state come from
 *   `resolveLocation` in `utils/locationResolver.ts` during dedup enrichment.
 * - Ashby: primary + `secondaryLocations` merged in `ashby.parser.ts`.
 * - Workday: API `locationsText` / `locations[]`, URL slug hints in `workday.parser.ts`, optional detail
 *   merge in `workday.detail.ts` (`locationsText` / `location` from CXS detail).
 */

export const SUPPORTED_ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "jobvite",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "rippling",
  "workday",
  /** Aggregator / fallback ingestion (not a crawlable ATS board). */
  "remoteok",
  "wellfound",
  /** Company careers HTML: shallow link crawl from enrichment-discovered URL. */
  "careers_page",
  /** Remote Rocketship OpenClaw feed — optional third-party source; not crawlable as an ATS board. */
  "openclaw",
] as const;
export type AtsType = (typeof SUPPORTED_ATS_TYPES)[number];
export const CRAWLABLE_ATS_TYPES: AtsType[] = [
  "greenhouse",
  "lever",
  "ashby",
  "jobvite",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "rippling",
  "workday",
];

export interface AtsCrawler<TRawJob> {
  readonly atsType: AtsType;
  fetchJobs(token: string): Promise<TRawJob[]>;
  parseJobs(rawJobs: TRawJob[], companyId: string): NormalizedJob[];
}

const ATS_RATE_LIMIT_MS: Record<AtsType, number> = {
  greenhouse: 200,
  lever: 300,
  ashby: 300,
  jobvite: 400,
  workable: 300,
  smartrecruiters: 300,
  bamboohr: 400,
  teamtailor: 400,
  rippling: 400,
  workday: 400,
  remoteok: 500,
  wellfound: 500,
  careers_page: 400,
  openclaw: 400,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function throttleByAts(atsType: AtsType): Promise<void> {
  const jitterMs = Math.floor(Math.random() * 101);
  await delay(ATS_RATE_LIMIT_MS[atsType] + jitterMs);
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 5000,
): Promise<T> {
  const res = await fetchWithRetry(
    url,
    { headers: { accept: "application/json" } },
    { ...DEFAULT_ATS_FETCH_RETRY, timeoutMs },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ATS request failed (${res.status} ${res.statusText}): ${text.slice(0, 500)}`,
    );
  }

  return (await res.json()) as T;
}

export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function inferRemote(text: string | undefined): boolean {
  if (!text) return false;
  const s = text.toLowerCase();
  if (s.includes("remote")) return true;
  if (/\b(wfh|work\s*from\s*home|work-from-home)\b/.test(s)) return true;
  if (/\b(work\s*at\s*home|work-at-home)\b/.test(s)) return true;
  if (/\b(telecommute|tele-commute|work\s+anywhere)\b/.test(s)) return true;
  if (/(fully|100%)\s*remote/.test(s)) return true;
  return false;
}

export function trimWhitespace(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeLocation(location: string | undefined): string | undefined {
  const trimmed = trimWhitespace(location);
  if (!trimmed) return undefined;
  return trimmed.replace(/\s+/g, " ");
}

export function sanitizeHtml(value: string | undefined): string | undefined {
  const trimmed = trimWhitespace(value);
  if (!trimmed) return undefined;
  const withoutTags = trimmed.replace(/<[^>]*>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
}

export function isSupportedAtsType(value: string): value is AtsType {
  return (SUPPORTED_ATS_TYPES as readonly string[]).includes(value);
}

