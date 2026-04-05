export interface SmartRecruitersJobLocation {
  city?: string;
  region?: string;
  country?: string;
}

export interface SmartRecruitersJob {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: SmartRecruitersJobLocation;
  ref?: string;
  applyUrl?: string;
  description?: string;
  postedAt?: string;
  companyToken?: string;
}

export interface SmartRecruitersJobsResponse {
  content?: SmartRecruitersJob[];
  totalFound?: number;
  limit?: number;
  offset?: number;
}

