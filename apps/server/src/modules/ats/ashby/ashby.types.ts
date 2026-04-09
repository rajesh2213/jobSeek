export interface AshbyJobLocation {
  location?: string;
  name?: string;
}

export interface AshbySecondaryLocation {
  location?: string;
}

export interface AshbyJob {
  id?: string;
  title?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  location?: AshbyJobLocation | string | null;
  /** Additional office locations from the public posting API. */
  secondaryLocations?: AshbySecondaryLocation[];
  isRemote?: boolean;
  jobUrl?: string;
  externalLink?: string;
  postedDate?: string;
  createdAt?: string;
}

export interface AshbyJobBoardResponse {
  jobs?: AshbyJob[];
}

