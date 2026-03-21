export interface WorkableLocation {
  location_str?: string;
  country?: string;
  city?: string;
}

export interface WorkableJob {
  title?: string;
  description?: string;
  full_description?: string;
  location?: WorkableLocation;
  url?: string;
  shortcode?: string;
  published?: string;
}

export interface WorkableJobsResponse {
  results?: WorkableJob[];
}

