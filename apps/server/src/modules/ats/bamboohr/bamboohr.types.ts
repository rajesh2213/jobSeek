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
  id?: number | string;
  title?: string;
  sourceUrl?: string;
  location?: string;
  description?: string;
  postedAt?: string;
  salary?: import("../../../utils/jobDetailHtml.js").JsonLdSalary | null;
}

