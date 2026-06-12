export interface WorkdayToken {
  host: string;
  tenant: string;
  site: string;
}

export interface WorkdayLocation {
  country?: string;
  region?: string;
  city?: string;
}

export interface WorkdayJob {
  bulletFields?: string[];
  /** Primary listing path from CXS API (may be relative). */
  externalPath?: string;
  /** Full URL when API provides it (preferred). */
  jobPostingUrl?: string;
  /** Direct apply URL when different from listing. */
  applyUrl?: string;
  externalUrl?: string;
  locationsText?: string;
  postedOn?: string;
  /** CXS detail `jobPostingInfo.startDate` — ISO publish date (merged from detail fetch). */
  startDate?: string;
  title?: string;
  jobDescription?: string;
  jobDescriptionHtml?: string;
  locations?: WorkdayLocation[];
}

export interface WorkdayJobsResponse {
  jobPostings?: WorkdayJob[];
  total?: number;
}

/** CXS GET job detail JSON (`/wday/cxs/{tenant}/{site}{externalPath}`). */
export interface WorkdayJobPostingInfo {
  title?: string;
  jobDescription?: string;
  jobDescriptionHtml?: string;
  location?: string;
  locationsText?: string;
  postedOn?: string;
  /** Provider-supplied first-publish date (`YYYY-MM-DD` or ISO). */
  startDate?: string;
  externalUrl?: string;
}

export interface WorkdayJobDetailResponse {
  jobPostingInfo?: WorkdayJobPostingInfo;
}

export interface WorkdayRawJob {
  token: WorkdayToken;
  job: WorkdayJob;
}
