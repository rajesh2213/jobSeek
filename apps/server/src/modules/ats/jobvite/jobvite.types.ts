export interface JobviteJobLocationAddress {
  addressLocality?: string;
  addressCountry?: string;
}

export interface JobviteJobLocation {
  address?: JobviteJobLocationAddress;
}

export interface JobviteJsonLdJobPosting {
  title?: string;
  url?: string;
  description?: string;
  datePosted?: string;
  jobLocation?: JobviteJobLocation;
}

export interface JobviteRawJob {
  title?: string;
  sourceUrl?: string;
  description?: string;
  postedAt?: string;
  location?: string;
  salary?: import("../../../utils/jobDetailHtml.js").JsonLdSalary | null;
}

