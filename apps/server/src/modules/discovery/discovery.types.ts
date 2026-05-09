export const DISCOVER_SOURCE = "discover-source";
export const PROCESS_COMPANY = "process-company";

export type DiscoverySourceType =
  | "yc"
  | "github"
  | "fortune500"
  | "weworkremotely"
  | "remoteok"
  | "openclaw";

export interface DiscoverySourceCompany {
  name: string;
  domain?: string;
}

export interface DiscoverSourcePayload {
  source: DiscoverySourceType;
}

export interface ProcessCompanyPayload extends DiscoverySourceCompany {
  source: DiscoverySourceType;
}

export interface CareersDetectionResult {
  careersUrl: string | null;
  html: string | null;
}
