import type { AtsType } from "../ats/ats.interface.js";

export const CRAWL_COMPANY_JOBS = "crawl-company-jobs";
/** Same handler as crawl-company-jobs; used after ATS detection from enrichment. */
export const INGEST_ATS_JOBS = "ingest-ats-jobs";
/** When ATS crawl is unavailable: RemoteOK + optional Wellfound page hints. */
export const INGEST_JOBS_FROM_SOURCE = "ingest-jobs-from-source";
/** Lightweight HTML link crawl from a discovered careers/listing URL (after enrichment). */
export const INGEST_JOBS_FROM_SOURCE_URL = "ingest-jobs-from-source-url";
export const PROCESS_JOB = "process-job";

export interface IngestJobsFromSourcePayload {
  companyId: string;
  companyName: string;
  domain: string | null;
  /** From bulk CSV Wellfound column when present. */
  wellfoundUrl: string | null;
}

export interface IngestJobsFromSourceUrlPayload {
  companyId: string;
  companyName: string;
  /** Page to fetch and scrape job-like links from. */
  url: string;
}

export interface CrawlCompanyJobsPayload {
  companyId?: string;
  companyName: string;
  atsType?: AtsType;
  atsBoardToken?: string;
  greenhouseBoardToken: string;
}

export interface NormalizedJob {
  title: string;
  description?: string;
  /** Raw ATS location line (city, country, etc.). */
  location?: string;
  isRemote: boolean;
  source: AtsType;
  sourceUrl: string;
  /** External apply URL when distinct from listing URL (e.g. Workday apply link). */
  applyUrl?: string;
  postedAt?: Date;
  companyId: string;
  /** Display name for ensure-company-from-job when companyId is unknown. */
  companyName?: string;
  atsJobId?: string;
}

/**
 * Enriched ingestion row: `country` is ISO 3166-1 alpha-2 or UNKNOWN.
 */
export interface DedupJobInput extends Omit<NormalizedJob, "location"> {
  companyDomain: string;
  category: string;
  role: string;
  skills: string[];
  country: string;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string;
  locationRegion: string | null;
  salaryMin: number | null;
  /** When set, overrides remote/onsite derivation from `isRemote`. */
  workType?: "remote" | "onsite" | "hybrid";
  experienceLevel?: string | null;
  /** True when raw ATS location listed multiple distinct countries (e.g. Berlin | Paris). */
  hasMultipleLocations?: boolean;
}