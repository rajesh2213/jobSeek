export interface BambooHrApiJob {
  id?: number | string;
  jobOpeningName?: string;
  location?: string;
  employmentStatusLabel?: string;
}

export interface BambooHrApiResponse {
  result?: BambooHrApiJob[];
}

export interface BambooHrRawJob {
  title?: string;
  sourceUrl?: string;
  location?: string;
  description?: string;
}

