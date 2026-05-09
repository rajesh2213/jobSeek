/**
 * Remote Rocketship OpenClaw jobs API — response shapes are defensive / partial.
 * @see https://www.remoterocketship.com/api/openclaw/jobs (POST, Bearer token)
 */

export interface OpenClawJobsSearchRequest {
  filters: Record<string, unknown>;
  includeJobDescription?: boolean;
}

export interface OpenClawJobCompanyHints {
  companyName?: string;
  domain?: string;
  careersUrl?: string;
  atsType?: string;
  atsBoardToken?: string;
}
