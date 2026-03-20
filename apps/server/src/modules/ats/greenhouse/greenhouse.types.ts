export interface GreenhouseLocation {
  name: string;
}

export interface GreenhouseJobSummary {
  id: number;
  internal_job_id?: number | null;
  title: string;
  updated_at: string;
  location?: GreenhouseLocation;
  absolute_url?: string;
  content?: string;
}

export interface GreenhouseJobListResponse {
  jobs: GreenhouseJobSummary[];
  meta: { total: number };
}

