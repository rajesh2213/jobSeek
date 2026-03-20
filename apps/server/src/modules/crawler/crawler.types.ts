import type { AtsType } from "../ats/ats.interface.js";

export const CRAWL_COMPANY_JOBS = "crawl-company-jobs";
export const PROCESS_JOB = "process-job";

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
  location?: string;
  isRemote: boolean;
  source: AtsType;
  sourceUrl: string;
  postedAt?: Date;
  companyId: string;
}

