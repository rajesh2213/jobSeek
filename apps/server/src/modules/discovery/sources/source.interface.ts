import type {
  DiscoverySourceCompany,
  DiscoverySourceType,
} from "../discovery.types.js";

export interface CompanySource {
  readonly source: DiscoverySourceType;
  fetchCompanies(): Promise<DiscoverySourceCompany[]>;
}

export function normalizeSourceCompany(
  input: DiscoverySourceCompany,
): DiscoverySourceCompany {
  const name = input.name.trim().replace(/\s+/g, " ");
  const domain = input.domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return { name, domain };
}

