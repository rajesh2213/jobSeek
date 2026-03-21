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
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  title?: string;
  jobDescription?: string;
  locations?: WorkdayLocation[];
}

export interface WorkdayJobsResponse {
  jobPostings?: WorkdayJob[];
  total?: number;
}

export interface WorkdayRawJob {
  token: WorkdayToken;
  job: WorkdayJob;
}

