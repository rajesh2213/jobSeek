export interface AshbyJobLocation {
  location?: string;
  name?: string;
}

export interface AshbyJob {
  id?: string;
  title?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  location?: AshbyJobLocation | string | null;
  isRemote?: boolean;
  jobUrl?: string;
  externalLink?: string;
  postedDate?: string;
  createdAt?: string;
}

export interface AshbyJobBoardResponse {
  jobs?: AshbyJob[];
}

