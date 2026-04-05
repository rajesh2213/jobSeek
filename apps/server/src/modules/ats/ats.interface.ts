import type { NormalizedJob } from "../crawler/crawler.types.js";
import {
  DEFAULT_ATS_FETCH_RETRY,
  fetchWithRetry,
} from "../../utils/fetchWithRetry.js";

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

export function inferRemote(location: string | undefined): boolean {
  return (location ?? "").toLowerCase().includes("remote");
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

