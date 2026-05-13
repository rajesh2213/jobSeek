export interface AshbyJobLocation {
  location?: string;
  name?: string;
}

export interface AshbySecondaryLocation {
  location?: string;
}

export interface AshbyPostalAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
  postalCode?: string;
  streetAddress?: string;
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
  /** Structured address from Ashby posting API (locality / region / country). */
  address?: { postalAddress?: AshbyPostalAddress };
  workplaceType?: string | null;
  jobUrl?: string;
  externalLink?: string;
  postedDate?: string;
  publishedAt?: string;
  createdAt?: string;
}

export interface AshbyJobBoardResponse {
  jobs?: AshbyJob[];
}

