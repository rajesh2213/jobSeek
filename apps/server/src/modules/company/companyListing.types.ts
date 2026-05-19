export type CompaniesListingSort = "jobs" | "recent" | "name";

export interface CompaniesListingInput {
  q: string;
  sort: CompaniesListingSort;
  hiring: boolean;
  remote: boolean;
  limit: number;
  offset: number;
}

/** Row returned by listCompaniesDiscovery (public listing). */
export type CompanyListingRowWithTotal = CompanyListingRow & {
  _listingTotal: number;
};

/** Row returned by listCompaniesDiscovery (public listing). */
export interface CompanyListingRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  careersUrl: string | null;
  createdAt: Date;
  lastCrawledAt: Date | null;
  updatedAt: Date;
  jobCount: number;
  hasRemoteJobs: boolean;
}
