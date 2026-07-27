import type { JobFilters } from "./slug-parser";
import { resolveApiBaseUrl } from "./apiBaseUrl";
import { jobDetailCacheTag } from "./jobDetailCacheTags";
import { formatUserLocalResetForMessage } from "./userLocalResetTime";

export interface JobCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  domain?: string | null;
  careerPage?: string | null;
  openRoles?: number;
}

export type CompaniesSort = "jobs" | "recent" | "name";

export interface CompanyListItem {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl?: string | null;
  careersUrl: string | null;
  createdAt: string;
  /** Canonical open roles (listing API; same discovery guard as visible jobs). */
  jobCount?: number;
  hasRemoteJobs?: boolean;
  /** Publishable roles on the company hub (`GET /company/:slug`). */
  visibleJobCount?: number;
  remoteJobCount?: number;
  lastCrawledAt?: string | null;
}

export interface CompanyDetail extends CompanyListItem {
  atsBoardToken: string | null;
  atsType: string | null;
  updatedAt: string;
  /** Any Job row ever existed for this company (OG-1.1 evergreen indexability). */
  hasEverHadJobs?: boolean;
}

export interface CountrySuggestion {
  name: string;
  code: string;
  slug: string;
}

/** Structured parse from ML service (stored on Job.parsedDescription). */
export interface ParsedJobDescription {
  position: string[];
  responsibility: string[];
  requirement: string[];
  experience: string[];
  benefit: string[];
  contact: string[];
  other: string[];
}

/** Rule-based enrichment from parsed description (server `Job.enriched`). */
export interface JobEnrichment {
  techStack: string[];
  salary: string | null;
  remote: boolean;
  remoteType: "remote" | "hybrid" | "onsite" | null;
}

export type JobPreviewLinesSource =
  | "responsibility"
  | "requirement"
  | "benefit"
  | "other"
  | "fallback";

/**
 * Backend-owned freshness contract.
 *
 * Mirrors the `Freshness` type in `apps/server/src/utils/freshness.ts`. The
 * server emits this on every job mapper output (list + detail + capped detail).
 * Clients MUST consume this object instead of inferring "Posted" vs "Added"
 * themselves from `postedAt != null` — that inference is unreliable due to
 * historical proxy contamination and per-adapter inconsistency.
 */
export type FreshnessSource = "POSTED" | "DISCOVERED";

export interface JobFreshness {
  /** POSTED = job has a real employer-supplied publish date; DISCOVERED = we only know when we found it. */
  source: FreshnessSource;
  /** Prefix word for UI. Localizable later. */
  label: "Posted" | "Added";
  /** ISO 8601 timestamp paired with the label. For POSTED this is `postedAt`; for DISCOVERED this is `createdAt`. */
  timestamp: string;
  /** Server-rendered "Posted 3 hours ago" — safe for SSR / JSON-LD / email; client ticker can override on long-lived pages. */
  relative: string;
}

export interface JobItem {
  id: string;
  title: string;
  description: string | null;
  /** Capped-detail fallback for SSR JobPosting JSON-LD only (UI remains redacted). */
  structuredDataDescription?: string | null;
  /** Card/list preview derived from parsed buckets (server). */
  previewLines?: string[];
  previewLinesSource?: JobPreviewLinesSource;
  parsedDescription?: ParsedJobDescription | null;
  enriched?: JobEnrichment | null;
  country: string;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string;
  locationRegion?: string | null;
  category: string;
  isRemote: boolean;
  workType?: string;
  experienceLevel?: string | null;
  role: string;
  skills: string[];
  salaryMin: number | null;
  salaryMax?: number | null;
  sourceUrl: string;
  applyUrl?: string | null;
  /** @deprecated Prefer `freshness.timestamp` + `freshness.source === "POSTED"`. Still present for backward compatibility with v1 clients. */
  postedAt: string | null;
  /** @deprecated Same instant as listing freshness / DB `listingFreshnessAt`. Prefer `freshness.timestamp`. */
  effectivePostedAt?: string | null;
  /** @deprecated Prefer `freshness.timestamp` when `freshness.source === "DISCOVERED"`. */
  createdAt?: string;
  /** Backend-owned freshness contract — Phase 7 of the freshness-integrity overhaul. */
  freshness?: JobFreshness;
  status?: "processing" | "ready" | "failed" | null;
  /** Discovery lifecycle flag from Prisma (`Job.isActive`). False after expiry purge. */
  isActive?: boolean;
  /** ISO expiry from retention policy (`Job.expiresAt`). Omitted when null in DB. */
  expiresAt?: string | null;
  companyId: string;
  company: JobCompany;
}

export function isJobReady(job: Pick<JobItem, "status" | "parsedDescription">): boolean {
  const effectiveStatus = job.status ?? "ready";
  if (effectiveStatus === "ready") return true;
  // Rollout safety: treat parsed rows as effectively ready during transition windows.
  return job.parsedDescription != null;
}

export type DiscoveryListPhase = "search" | "preview";

export interface JobsApiResponse {
  data: JobItem[];
  meta?: {
    page: number;
    pageSize: number;
    total: number | null;
    totalCount?: number | null;
    totalPages?: number;
    offset?: number;
    hasMore?: boolean;
    capReached?: boolean;
    remaining?: number | null;
    debitedCount?: number;
    remainingBefore?: number | null;
    remainingAfter?: number | null;
    resetAt?: string;
    totalHidden?: number;
    viewCapUnlimited?: boolean;
    /** Free-tier discovery list metering (from GET /jobs meta). */
    discoveryPhase?: DiscoveryListPhase;
    limit?: {
      mode: "soft" | "hard";
      remaining: number | null;
      resetAt: string;
      warning: boolean;
      isCapped: boolean;
    };
    company?: {
      id: string;
      name: string;
      slug: string;
      domain: string;
    };
  };
}

/**
 * Coerces list pagination meta after JSON/RSC boundaries.
 * Without this, `listMeta.page` can be missing → `undefined + 1` is NaN → `buildJobDiscoverySearchParams`
 * skips `page` (NaN is falsy) → GET /jobs defaults to page 1 → Load more fetches duplicates, quota meta gets overwritten by SSR snapshot.
 */
export function normalizeJobsListMeta(
  meta: JobsApiResponse["meta"] | undefined,
): JobsApiResponse["meta"] | undefined {
  if (!meta) return undefined;
  const page = Number(meta.page);
  const pageSize = Number(meta.pageSize);
  return {
    ...meta,
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 20,
  };
}

interface CompaniesApiResponse {
  data: CompanyListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore?: boolean;
    stats?: {
      totalTracked: number;
      hiringThisWeek: number;
      activeHiringCompanies: number;
    };
  };
}

interface CompanyApiResponse {
  data: CompanyDetail;
}

interface JobApiResponse {
  data: JobItem;
  meta?: JobDetailCapMeta;
}

export interface JobDetailCapMeta {
  capReached?: boolean;
  remaining?: number | null;
  resetAt?: string;
  viewCapUnlimited?: boolean;
  limit?: {
    mode: "soft" | "hard";
    remaining: number | null;
    resetAt: string;
    warning: boolean;
    isCapped: boolean;
  };
}

export type JobDetailFetchResult = {
  data: JobItem;
  meta?: JobDetailCapMeta;
};

/**
 * Fastify API origin. Must point at the Fastify API server, not the Next.js dev server:
 * same host/path as `/health` and `/locations/cities`. If Next runs on 3000, run
 * the API on another `PORT` and set `NEXT_PUBLIC_API_BASE_URL` (and `API_BASE_URL`
 * for SSR) to that origin, e.g. `http://127.0.0.1:3000`.
 */
export const API_BASE_URL = resolveApiBaseUrl();

/** Free-tier AI resume–job match quota (rolling ~24h, server Redis). Null for Pro or when unavailable. */
export interface ResumeMatchAiQuotaState {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

export interface AccountSummary {
  plan: "free" | "pro";
  jobViewsToday: number;
  jobViewsLimit: number | null;
  resetAt: string;
  resumeMatchAi?: ResumeMatchAiQuotaState | null;
}

/** Response from `GET /api/user/me` (proxies Fastify `/account/summary`). */
export type UserMeResponse = AccountSummary;

export interface SavedSearchItem {
  id: string;
  name: string | null;
  query: string;
  createdAt: string;
  updatedAt: string;
  alertEnabled: boolean;
  alertThreshold: number;
  alertLastSentAt: string | null;
  alertJobsSeen: number;
}

export interface SavedSearchAlertStatusItem {
  id: string;
  name: string | null;
  alertEnabled: boolean;
  alertThreshold: number;
  alertLastSentAt: string | null;
}

export interface SavedSearchCreateResponse {
  data: SavedSearchItem;
}

export interface SavedSearchListResponse {
  data: SavedSearchItem[];
  meta: { count: number; limit: number };
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  /** Populated for HTTP 429 + `RESUME_MATCH_AI_QUOTA_EXCEEDED` from semantic-match. */
  resumeMatchAiQuota?: ResumeMatchAiQuotaState;

  constructor(message: string, status: number, code?: string, resumeMatchAiQuota?: ResumeMatchAiQuotaState) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.resumeMatchAiQuota = resumeMatchAiQuota;
  }
}

/** Server or client: JobLoom usage stats (requires signed-in Clerk JWT). */
export async function fetchAccountSummary(token: string): Promise<AccountSummary | null> {
  const t = token.trim();
  if (!t) return null;
  const res = await fetch(`${API_BASE_URL}/account/summary`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as AccountSummary;
}

export interface BillingStatusResponse {
  plan: "free" | "pro";
  subscription: {
    provider: string;
    status: string;
    currentPeriodEnd: string;
    graceEndsAt: string | null;
  } | null;
}

/** Authoritative subscription row + effective plan (for post-checkout polling). */
export async function fetchBillingStatus(token: string): Promise<BillingStatusResponse | null> {
  const t = token.trim();
  if (!t) return null;
  const res = await fetch(`${API_BASE_URL}/billing/status`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as BillingStatusResponse;
}

export interface BillingCancelResponse {
  success: boolean;
  provider: "paypal" | "dodo";
  effectiveUntil: string;
  alreadyCanceled?: boolean;
}

export async function cancelSubscription(
  token: string,
  reason?: string,
): Promise<BillingCancelResponse> {
  const t = token.trim();
  const res = await fetch(`${API_BASE_URL}/billing/cancel-subscription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  const data = (await res.json().catch(() => ({}))) as BillingCancelResponse & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new ApiRequestError(data.error ?? "Could not cancel subscription.", res.status, data.code);
  }
  return data;
}

export interface ApplyProfileCustomQA {
  question: string;
  answer: string;
}

export type SmartApplyTone = "professional" | "friendly" | "formal" | "casual";
export type SmartApplyLength = "short" | "medium" | "long";

export interface SmartApplyPreferencesClient {
  tone?: SmartApplyTone;
  length?: SmartApplyLength;
  firstPerson?: boolean;
}

export interface ApplyProfileResponse {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  workAuthorization: string | null;
  salaryExpectation: string | null;
  currentCompensation: string | null;
  availableFrom: string | null;
  noticePeriod: string | null;
  relocationPreference: string | null;
  remotePreference: string | null;
  yearsOfExperience: number | null;
  currentTitle: string | null;
  currentCompany: string | null;
  professionalSummary: string | null;
  languages: string | null;
  certifications: string | null;
  highestEducation: string | null;
  customQA: ApplyProfileCustomQA[];
  applyProfileSummary: unknown;
  resumeStructuredV1: unknown;
  smartApplyPreferences: SmartApplyPreferencesClient | null;
  applyProfileExtras: unknown;
  profileExtractLastAt: string | null;
  extractDailyLimitBypassed?: boolean;
  hasResume: boolean;
  resumeFileName: string | null;
  resumeUpdatedAt: string | null;
  resumeWordCount: number;
}

export type ApplyProfilePatch = Partial<{
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  workAuthorization: string | null;
  salaryExpectation: string | null;
  currentCompensation: string | null;
  availableFrom: string | null;
  noticePeriod: string | null;
  relocationPreference: string | null;
  remotePreference: string | null;
  yearsOfExperience: number | null;
  currentTitle: string | null;
  currentCompany: string | null;
  professionalSummary: string | null;
  languages: string | null;
  certifications: string | null;
  highestEducation: string | null;
  customQA: ApplyProfileCustomQA[];
  smartApplyPreferences: SmartApplyPreferencesClient | null;
  applyProfileExtras: unknown;
}>;

export async function fetchApplyProfile(token: string): Promise<ApplyProfileResponse | null> {
  const t = token.trim();
  if (!t) return null;
  const res = await fetch(`${API_BASE_URL}/account/apply-profile`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as ApplyProfileResponse;
}

export async function patchApplyProfile(
  token: string,
  body: ApplyProfilePatch,
): Promise<ApplyProfileResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");
  const res = await fetch(`${API_BASE_URL}/account/apply-profile`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(err.error ?? "Failed to save profile", res.status, err.code);
  }
  return (await res.json()) as ApplyProfileResponse;
}

export async function extractProfileFromResume(token: string): Promise<{
  success: boolean;
  mergedFields: string[];
  resetAt: string;
}> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");
  const res = await fetch(`${API_BASE_URL}/account/resume/extract-profile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
    },
  });
  if (res.status === 429) {
    const err = (await res.json().catch(() => ({}))) as { resetAt?: string; message?: string; code?: string };
    const reset =
      err.resetAt != null
        ? ` Next import after ${formatUserLocalResetForMessage(err.resetAt)}.`
        : "";
    throw new ApiRequestError(
      (err.message ?? "Daily limit for profile import") + reset,
      429,
      err.code,
    );
  }
  if (res.status === 400) {
    const err = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      code?: string;
    };
    const msg =
      (typeof err.message === "string" && err.message.trim()) ||
      (typeof err.error === "string" && err.error.trim()) ||
      "Could not import profile from your resume.";
    throw new ApiRequestError(msg, res.status, err.code);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiRequestError(err.message ?? err.error ?? "Extract failed", res.status);
  }
  return (await res.json()) as { success: boolean; mergedFields: string[]; resetAt: string };
}

export interface SmartApplyStatusResponse {
  jobsToday: number;
  jobsLimit: number;
  jobsRemaining: number;
  resetsAt: string;
  plan: string;
  profileComplete: boolean;
  profileCompletionPct: number;
}

export async function fetchSmartApplyStatus(
  token: string,
): Promise<SmartApplyStatusResponse | null> {
  const t = token.trim();
  if (!t) return null;
  const res = await fetch(`${API_BASE_URL}/account/smart-apply/status`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as SmartApplyStatusResponse;
}

export interface SmartApplyBatchAnswerResponse {
  answers: Array<{ id: string; answer: string }>;
  answerMeta?: Array<{
    id: string;
    source: "structured" | "llm";
    confidence: "high" | "medium" | "low";
  }>;
  tokensUsed: number;
  jobsRemainingToday: number;
  jobsLimit: number;
}

export type SmartApplyEventName =
  | "resume_uploaded"
  | "extension_installed_clicked"
  | "ats_page_detected"
  | "fields_detected_count"
  | "fill_started"
  | "fill_completed"
  | "long_answer_generated_count"
  | "answer_edited_before_apply"
  | "session_to_first_success_time";

export async function postSmartApplyEvent(
  token: string,
  event: SmartApplyEventName,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const t = token.trim();
  if (!t) return;
  await fetch(`${API_BASE_URL}/account/smart-apply/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event, payload }),
  });
}

export async function batchSmartApplyAnswers(
  token: string,
  payload: {
    questions: Array<{
      id: string;
      question: string;
      charLimit?: number;
      kind?: "structured" | "free_text";
    }>;
    jobTitle: string;
    companyName: string;
    jobId?: string;
    /** Overrides stored profile preferences for this request only. */
    preferenceOverrides?: SmartApplyPreferencesClient;
  },
): Promise<SmartApplyBatchAnswerResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");
  const res = await fetch(`${API_BASE_URL}/account/smart-apply/batch-answer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 403) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new ApiRequestError(err.message ?? "Upgrade to Pro", 403, err.code);
  }
  if (res.status === 429) {
    const err = (await res.json().catch(() => ({}))) as { resetAt?: string; code?: string };
    const when =
      err.resetAt != null ? formatUserLocalResetForMessage(err.resetAt) : "";
    throw new ApiRequestError(
      when
        ? `Daily limit reached. Next reset: ${when}.`
        : "Daily limit reached. Try again after the next reset.",
      429,
      err.code,
    );
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiRequestError(
      err.message ?? err.error ?? "Failed to generate answers",
      res.status,
    );
  }
  return (await res.json()) as SmartApplyBatchAnswerResponse;
}

export async function createSavedSearch(
  token: string,
  payload: { query: string; name?: string },
): Promise<SavedSearchItem> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to create saved search",
      res.status,
      body.code,
    );
  }
  const body = (await res.json()) as SavedSearchCreateResponse;
  return body.data;
}

export async function fetchSavedSearches(token: string): Promise<SavedSearchListResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to fetch saved searches",
      res.status,
      body.code,
    );
  }
  return (await res.json()) as SavedSearchListResponse;
}

export async function deleteSavedSearch(token: string, id: string): Promise<void> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  // Idempotent: duplicate taps or races may 404 after the row is already gone.
  if (res.status === 404) return;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to delete saved search",
      res.status,
      body.code,
    );
  }
}

export async function renameSavedSearch(
  token: string,
  id: string,
  name: string | null,
): Promise<SavedSearchItem> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to rename saved search",
      res.status,
      body.code,
    );
  }
  const body = (await res.json()) as SavedSearchCreateResponse;
  return body.data;
}

export async function fetchSavedSearchAlertStatus(
  token: string,
): Promise<SavedSearchAlertStatusItem[]> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches/alert-status`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to load alert status",
      res.status,
      body.code,
    );
  }
  const body = (await res.json()) as { data: SavedSearchAlertStatusItem[] };
  return body.data ?? [];
}

export async function patchSavedSearchAlert(
  token: string,
  id: string,
  payload: { enabled: boolean; threshold?: 5 | 10 },
): Promise<SavedSearchItem> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/saved-searches/${encodeURIComponent(id)}/alert`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enabled: payload.enabled,
      threshold: payload.threshold,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(
      body.error ?? "Failed to update alert",
      res.status,
      body.code,
    );
  }
  const body = (await res.json()) as { data: SavedSearchItem };
  return body.data;
}

export interface LocationCountryOption {
  code: string;
  name: string;
  region: string;
}

export interface LocationsCatalogResponse {
  regions: string[];
  countries: LocationCountryOption[];
}

export async function fetchLocationsCatalog(): Promise<LocationsCatalogResponse> {
  const res = await fetch(`${API_BASE_URL}/locations`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch locations: ${res.status}`);
  }
  return (await res.json()) as LocationsCatalogResponse;
}

export interface CitySuggestion {
  city: string;
  country: string;
  region: string;
  count: number;
}

export async function fetchCitySuggestions(q: string): Promise<CitySuggestion[]> {
  const t = q.trim();
  if (t.length < 2) return [];
  const url = `${API_BASE_URL}/locations/cities?q=${encodeURIComponent(t)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch city suggestions: ${res.status}`);
  }
  return (await res.json()) as CitySuggestion[];
}

/** Shared with `GET /jobs` and `GET /company/:slug/jobs` (omit `companyId` for the latter). */
function buildJobDiscoverySearchParams(
  filters: JobFilters,
  opts?: { includeCompanyId?: boolean },
): URLSearchParams {
  const params = new URLSearchParams();
  const rawPage =
    filters.page !== undefined && filters.page !== null ? Number(filters.page) : NaN;
  if (Number.isFinite(rawPage) && rawPage >= 1) {
    params.set("page", String(Math.floor(rawPage)));
  }
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.locations?.length) {
    params.set("locations", filters.locations.join(","));
  } else if (filters.location?.trim()) {
    params.set("location", filters.location.trim());
  } else if (filters.country?.trim()) {
    params.set("country", filters.country.trim());
  }
  if (filters.categories?.length) {
    params.set("categories", filters.categories.join(","));
  } else if (filters.category) {
    params.set("category", filters.category);
  }
  if (filters.surface === "seo") {
    params.set("surface", "seo");
  }
  if (filters.workTypes?.length) {
    params.set("types", filters.workTypes.map((t) => t.toUpperCase()).join(","));
  }
  if (typeof filters.isRemote === "boolean") params.set("remote", String(filters.isRemote));
  if (filters.companyId && opts?.includeCompanyId !== false) {
    params.set("companyId", filters.companyId);
  }
  if (filters.role) params.set("role", filters.role);
  if (filters.roles?.length) params.set("roles", filters.roles.join(","));
  if (filters.skills?.length) params.set("skills", filters.skills.join(","));
  if (filters.experience) params.set("experience", filters.experience);
  if (filters.posted) params.set("posted", filters.posted);
  if (filters.minSalary !== undefined) params.set("minSalary", String(filters.minSalary));
  if (filters.sort === "salary_desc") params.set("sort", "salary_desc");
  return params;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJobsListResponse(res: Response): Promise<JobsApiResponse> {
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as JobsApiResponse;
    return {
      ...body,
      data: (body.data ?? []).filter(isJobReady),
      meta: normalizeJobsListMeta(body.meta),
    };
  }
  const bodyText = await res.text();
  let body: JobsApiResponse & { code?: string };
  try {
    body = JSON.parse(bodyText) as JobsApiResponse & { code?: string };
  } catch {
    throw new Error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);
  }
  if (!res.ok) {
    if (res.status === 500 && body.code === "P2024") {
      return { data: [], meta: normalizeJobsListMeta(body.meta) };
    }
    throw new Error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);
  }
  return {
    ...body,
    data: (body.data ?? []).filter(isJobReady),
    meta: normalizeJobsListMeta(body.meta),
  };
}

export async function fetchJobs(
  filters: JobFilters = {},
  opts?: {
    /** Clerk session JWT for per-user view caps. */
    token?: string | null;
    /** Server-only internal SEO bypass secret (`INTERNAL_SEO_SECRET`). */
    internalSeoSecret?: string | null;
    /** Server-side only: pass through client IP chain to API for anon caps. */
    forwardedFor?: string | null;
    /** Server-side callsite label for SSR attribution. */
    ssrPage?: string;
    /** Abort slow upstream reads (SSR budget). */
    signal?: AbortSignal | null;
  },
): Promise<JobsApiResponse> {
  const params = buildJobDiscoverySearchParams(filters, { includeCompanyId: true });

  /**
   * In the browser, call Next `/api/jobs` so the route forwards visitor `x-forwarded-for`
   * (same as SSR). Direct `NEXT_PUBLIC_API_BASE_URL` requests often lack that chain upstream.
   * Disable with `NEXT_PUBLIC_JOBS_BROWSER_PROXY=0`.
   */
  const useBrowserJobsProxy =
    typeof window !== "undefined" &&
    (process.env.NEXT_PUBLIC_JOBS_BROWSER_PROXY ?? "1").trim() !== "0";
  const qs = params.toString() ? `?${params}` : "";
  const url = useBrowserJobsProxy
    ? `/api/jobs${qs}`
    : `${API_BASE_URL}/jobs${qs}`;
  const headers = new Headers();
  const t = opts?.token?.trim();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const internalSeoSecret = opts?.internalSeoSecret?.trim();
  const internalBypass = typeof window === "undefined" && Boolean(internalSeoSecret);
  if (internalBypass) {
    headers.set("x-internal-seo", "true");
    headers.set("x-internal-seo-secret", internalSeoSecret as string);
  }
  const forwardedFor = opts?.forwardedFor?.trim();
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (typeof window === "undefined") {
    headers.set("x-ssr-origin", "next-server");
    headers.set("x-ssr-page", opts?.ssrPage?.trim() || "jobs");
  }

  /** Metered discovery must not be cached by Next (stale caps / double-count risk). */
  const fetchOptions: RequestInit & { next?: { revalidate?: number } } = internalBypass
    ? { headers, next: { revalidate: 120 } }
    : { headers, cache: "no-store" };
  const browserRetries = typeof window !== "undefined" ? 4 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < browserRetries; attempt++) {
    const controller = new AbortController();
    const timeoutMs = typeof window === "undefined" ? 12_000 : 28_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const mergedSignal = opts?.signal ?? controller.signal;
    try {
      const res = await fetch(url, { ...fetchOptions, signal: mergedSignal });
      clearTimeout(timeout);
      const text = await res.text();
      let code: string | undefined;
      try {
        code = (JSON.parse(text) as { code?: string }).code;
      } catch {
        code = undefined;
      }
      const retryable =
        res.status === 503 ||
        code === "P2024" ||
        code === "DB_POOL_EXHAUSTED";
      if (retryable && attempt < browserRetries - 1) {
        await sleepMs(700 * (attempt + 1));
        continue;
      }
      const parsed = await parseJobsListResponse(
        new Response(text, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
      );
      if (
        retryable &&
        parsed.data.length === 0 &&
        attempt < browserRetries - 1
      ) {
        await sleepMs(700 * (attempt + 1));
        continue;
      }
      return parsed;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < browserRetries - 1) {
        await sleepMs(700 * (attempt + 1));
        continue;
      }
    }
  }

  if (lastError instanceof ApiRequestError) throw lastError;
  if (lastError instanceof Error) throw lastError;
  throw new ApiRequestError("Failed to fetch jobs", 503, "DB_POOL_EXHAUSTED");
}

export interface SeoSitemapJobRow {
  id: string;
  postedAt: string | null;
  createdAt: string;
  listingFreshnessAt: string;
}

/** Server-side: `GET /seo/sitemap-jobs` — keyset cursor, slim payload for sitemap only. */
export async function fetchSeoSitemapJobs(options?: {
  cursor?: string | null;
  limit?: number;
  internalSeoSecret?: string | null;
  signal?: AbortSignal | null;
}): Promise<{
  data: SeoSitemapJobRow[];
  meta: {
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  const url = `${API_BASE_URL}/seo/sitemap-jobs${qs ? `?${qs}` : ""}`;
  const headers = new Headers();
  const secret = (options?.internalSeoSecret ?? process.env.INTERNAL_SEO_SECRET)?.trim();
  if (secret && typeof window === "undefined") {
    headers.set("x-internal-seo", "true");
    headers.set("x-internal-seo-secret", secret);
    headers.set("x-ssr-origin", "next-server");
    headers.set("x-ssr-page", "sitemap");
  }
  const controller = new AbortController();
  const timeoutMs = 12_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const mergedSignal = options?.signal ?? controller.signal;
  try {
    const res = await fetch(url, {
      headers,
      cache: "no-store",
      signal: mergedSignal,
    });
    clearTimeout(timeout);
    if (res.status === 401) {
      throw new Error("fetchSeoSitemapJobs: unauthorized");
    }
    if (!res.ok) {
      throw new Error(`fetchSeoSitemapJobs: ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: SeoSitemapJobRow[];
      meta?: { count?: number; hasMore?: boolean; nextCursor?: string | null };
    };
    return {
      data: body.data ?? [],
      meta: {
        count: body.meta?.count ?? (body.data?.length ?? 0),
        hasMore: body.meta?.hasMore === true,
        nextCursor: body.meta?.nextCursor ?? null,
      },
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export interface SeoLandingEntry {
  slug: string;
  count: number;
}

/** Server-side: `GET /seo/landing-pages` (requires internal SEO secret headers). */
export async function fetchSeoLandingPages(options?: {
  minCount?: number;
  maxSlugs?: number;
  internalSeoSecret?: string | null;
  /**
   * Skip the Next.js data cache entirely.  Callers that already live behind
   * their own cache layer (e.g. sitemap's `unstable_cache`) should set this
   * to avoid double-caching / stale-while-revalidate serving old failures.
   */
  noCache?: boolean;
}): Promise<{
  data: SeoLandingEntry[];
  meta?: {
    minCount: number;
    maxSlugs: number;
    count: number;
    unauthorized?: boolean;
    authHeaderSent?: boolean;
    rolesConsidered?: number;
    locationsConsidered?: number;
    experiencesConsidered?: number;
    estimatedCountQueries?: number;
    estimatedTotalQueries?: number;
  };
}> {
  const params = new URLSearchParams();
  if (options?.minCount !== undefined) params.set("minCount", String(options.minCount));
  if (options?.maxSlugs !== undefined) params.set("maxSlugs", String(options.maxSlugs));
  const qs = params.toString();
  const url = `${API_BASE_URL}/seo/landing-pages${qs ? `?${qs}` : ""}`;
  const headers = new Headers();
  const secret = (options?.internalSeoSecret ?? process.env.INTERNAL_SEO_SECRET)?.trim();
  const authHeaderSent = Boolean(secret && typeof window === "undefined");
  if (secret && typeof window === "undefined") {
    headers.set("x-internal-seo", "true");
    headers.set("x-internal-seo-secret", secret);
  }
  const fetchOptions: RequestInit & { next?: { revalidate: number } } = { headers };
  if (options?.noCache) {
    fetchOptions.cache = "no-store";
  } else {
    fetchOptions.next = { revalidate: 300 };
  }
  const res = await fetch(url, fetchOptions);
  if (res.status === 401) {
    console.warn("[seo] landing-pages unauthorized", {
      apiBaseUrl: API_BASE_URL,
      authHeaderSent,
      minCount: options?.minCount ?? null,
      maxSlugs: options?.maxSlugs ?? null,
    });
    return {
      data: [],
      meta: {
        minCount: options?.minCount ?? 0,
        maxSlugs: options?.maxSlugs ?? 0,
        count: 0,
        unauthorized: true,
        authHeaderSent,
      },
    };
  }
  if (!res.ok) {
    throw new Error(`fetchSeoLandingPages: ${res.status}`);
  }
  return (await res.json()) as {
    data: SeoLandingEntry[];
    meta?: {
      minCount: number;
      maxSlugs: number;
      count: number;
      rolesConsidered?: number;
      locationsConsidered?: number;
      experiencesConsidered?: number;
      estimatedCountQueries?: number;
      estimatedTotalQueries?: number;
    };
  };
}

export interface SeoAggregationsResponse {
  data: {
    topSkills: Array<{ skill: string; count: number }>;
    topCompanies: Array<{ companyId: string; name: string; slug?: string | null; count: number }>;
    salary: { avg: number | null; min: number | null; max: number | null };
    hiringTrend: Array<{ day: string; count: number }>;
  };
}

export async function fetchSeoAggregations(options: {
  filtersSlug: string;
  internalSeoSecret?: string | null;
  signal?: AbortSignal;
}): Promise<SeoAggregationsResponse["data"]> {
  const secret = (options.internalSeoSecret ?? process.env.INTERNAL_SEO_SECRET)?.trim();
  const headers = new Headers();
  if (secret && typeof window === "undefined") {
    headers.set("x-internal-seo", "true");
    headers.set("x-internal-seo-secret", secret);
  }
  const url = `${API_BASE_URL}/seo/aggregations?filters=${encodeURIComponent(options.filtersSlug)}`;
  const res = await fetch(url, {
    headers,
    signal: options.signal,
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      topSkills: [],
      topCompanies: [],
      salary: { avg: null, min: null, max: null },
      hiringTrend: [],
    };
  }
  const payload = (await res.json()) as SeoAggregationsResponse;
  return payload.data;
}

export interface JobRoleSuggestion {
  slug: string;
  label: string;
  count: number;
}

export interface JobCategoryAggregate {
  slug: string;
  label: string;
  count: number;
}

export async function fetchRoles(): Promise<JobRoleSuggestion[]> {
  const now = Date.now();
  if (rolesCache && rolesCache.expiresAt > now) {
    return rolesCache.value;
  }
  if (rolesInFlight) {
    return rolesInFlight;
  }
  rolesInFlight = (async () => {
    const res = await fetch(`${API_BASE_URL}/jobs/roles`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch roles: ${res.status}`);
    }
    const body = (await res.json()) as { roles: JobRoleSuggestion[] };
    const rows = body.roles ?? [];
    rolesCache = {
      value: rows,
      expiresAt: Date.now() + TAXONOMY_CACHE_TTL_MS,
    };
    return rows;
  })().finally(() => {
    rolesInFlight = null;
  });
  return rolesInFlight;
}

export async function fetchJobCategories(): Promise<JobCategoryAggregate[]> {
  const res = await fetch(`${API_BASE_URL}/jobs/categories`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch job categories: ${res.status}`);
  }
  const body = (await res.json()) as { categories: JobCategoryAggregate[] };
  return body.categories ?? [];
}

export interface JobSkillAggregate {
  slug: string;
  count: number;
}

const TAXONOMY_CACHE_TTL_MS = 5 * 60 * 1000;
let rolesCache: { value: JobRoleSuggestion[]; expiresAt: number } | null = null;
let rolesInFlight: Promise<JobRoleSuggestion[]> | null = null;
let skillsCache: { value: JobSkillAggregate[]; expiresAt: number } | null = null;
let skillsInFlight: Promise<JobSkillAggregate[]> | null = null;

export async function fetchJobSkills(): Promise<JobSkillAggregate[]> {
  const now = Date.now();
  if (skillsCache && skillsCache.expiresAt > now) {
    return skillsCache.value;
  }
  if (skillsInFlight) {
    return skillsInFlight;
  }
  skillsInFlight = (async () => {
    const res = await fetch(`${API_BASE_URL}/jobs/skills`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch job skills: ${res.status}`);
    }
    const body = (await res.json()) as { skills: JobSkillAggregate[] };
    const rows = body.skills ?? [];
    skillsCache = {
      value: rows,
      expiresAt: Date.now() + TAXONOMY_CACHE_TTL_MS,
    };
    return rows;
  })().finally(() => {
    skillsInFlight = null;
  });
  return skillsInFlight;
}

export async function fetchCountrySuggestions(query: string): Promise<CountrySuggestion[]> {
  const q = query.trim();
  const url = `${API_BASE_URL}/locations/countries${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch countries: ${res.status}`);
  }
  return (await res.json()) as CountrySuggestion[];
}

export async function fetchCompanies(options: {
  page?: number;
  limit?: number;
  q?: string;
  sort?: CompaniesSort;
  hiring?: boolean;
  remote?: boolean;
  /** Server-side callsite label for SSR attribution. */
  ssrPage?: string;
  signal?: AbortSignal | null;
} = {}): Promise<CompaniesApiResponse> {
  const params = new URLSearchParams();
  const coPage =
    options.page !== undefined && options.page !== null ? Number(options.page) : NaN;
  if (Number.isFinite(coPage) && coPage >= 1) {
    params.set("page", String(Math.floor(coPage)));
  }
  if (options.limit) params.set("limit", String(options.limit));
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.sort && options.sort !== "jobs") params.set("sort", options.sort);
  if (options.hiring) params.set("hiring", "true");
  if (options.remote) params.set("remote", "true");
  const qs = params.toString();
  const useBrowserCompaniesProxy =
    typeof window !== "undefined" &&
    (process.env.NEXT_PUBLIC_JOBS_BROWSER_PROXY ?? "1").trim() !== "0";
  const url = useBrowserCompaniesProxy
    ? `/api/companies${qs ? `?${qs}` : ""}`
    : `${API_BASE_URL}/companies${qs ? `?${qs}` : ""}`;
  const isServer = typeof window === "undefined";
  const headers = new Headers();
  if (isServer) {
    headers.set("x-ssr-origin", "next-server");
    headers.set("x-ssr-page", options.ssrPage?.trim() || "companies");
  }
  const reqInit: RequestInit & { next?: { revalidate?: number } } = isServer
    ? { headers, next: { revalidate: 60 } }
    : { headers, cache: "no-store" };

  const browserRetries = typeof window !== "undefined" ? 4 : 1;
  const limit = options.limit ?? 24;

  for (let attempt = 0; attempt < browserRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22_000);
    const externalSignal = options.signal ?? undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeout);
        break;
      }
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(url, { ...reqInit, signal: controller.signal });
      clearTimeout(timeout);
      const text = await res.text();
      let code: string | undefined;
      try {
        code = (JSON.parse(text) as { code?: string }).code;
      } catch {
        code = undefined;
      }
      const retryable =
        res.status === 503 ||
        code === "P2024" ||
        code === "DB_POOL_EXHAUSTED";
      if (retryable && attempt < browserRetries - 1) {
        await sleepMs(800 * (attempt + 1));
        continue;
      }
      if (res.status === 503 || code === "DB_POOL_EXHAUSTED" || code === "P2024") {
        if (attempt < browserRetries - 1) {
          await sleepMs(800 * (attempt + 1));
          continue;
        }
        throw new ApiRequestError("Service temporarily busy", 503, "DB_POOL_EXHAUSTED");
      }
      if (!res.ok) {
        return {
          data: [],
          meta: {
            page: options.page ?? 1,
            limit,
            total: 0,
            totalPages: 1,
            hasMore: false,
          },
        };
      }
      return JSON.parse(text) as CompaniesApiResponse;
    } catch {
      clearTimeout(timeout);
      if (attempt < browserRetries - 1) {
        await sleepMs(800 * (attempt + 1));
        continue;
      }
    }
  }

  return {
    data: [],
    meta: {
      page: options.page ?? 1,
      limit,
      total: 0,
      totalPages: 1,
      hasMore: false,
    },
  };
}

export async function fetchCompanyBySlug(
  slug: string,
  opts?: { signal?: AbortSignal | null },
): Promise<CompanyDetail | null> {
  const res = await fetch(`${API_BASE_URL}/company/${encodeURIComponent(slug)}`, {
    next: { revalidate: 120 },
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const payload = (await res.json()) as CompanyApiResponse;
  return payload.data ?? null;
}

export async function fetchCompanyJobs(
  slug: string,
  options: {
    page?: number;
    limit?: number;
    /** Same discovery filters as `/jobs`; `companyId` is ignored (route scopes by slug). */
    filters?: Omit<JobFilters, "companyId">;
    /** Clerk JWT — company job lists share the same daily view cap as `/jobs`. */
    token?: string | null;
    /** Server-side only: pass through client IP chain to API for anon caps. */
    forwardedFor?: string | null;
    /** Server-side internal SEO bypass (SSR crawlers). */
    internalSeoSecret?: string | null;
    /** Server-side callsite label for SSR attribution. */
    ssrPage?: string;
    /** Abort slow upstream reads (SSR budget). */
    signal?: AbortSignal | null;
  } = {},
): Promise<JobsApiResponse> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const merged: JobFilters = {
    ...(options.filters ?? {}),
    page,
    limit,
    companyId: undefined,
  };
  const params = buildJobDiscoverySearchParams(merged, { includeCompanyId: false });
  const qs = params.toString();
  const url = `${API_BASE_URL}/company/${encodeURIComponent(slug)}/jobs${qs ? `?${qs}` : ""}`;
  const headers = new Headers();
  const t = options.token?.trim();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const internalSeoSecret = options.internalSeoSecret?.trim();
  const internalBypass = typeof window === "undefined" && Boolean(internalSeoSecret);
  if (internalBypass) {
    headers.set("x-internal-seo", "true");
    headers.set("x-internal-seo-secret", internalSeoSecret as string);
  }
  const forwardedFor = options.forwardedFor?.trim();
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (typeof window === "undefined") {
    headers.set("x-ssr-origin", "next-server");
    headers.set("x-ssr-page", options.ssrPage?.trim() || "company");
  }
  const fetchOptions: RequestInit & { next?: { revalidate?: number } } = internalBypass
    ? { headers, next: { revalidate: 120 } }
    : { headers, cache: "no-store" };
  if (options.signal) fetchOptions.signal = options.signal;
  const res = await fetch(url, fetchOptions);
  if (res.status === 404) {
    return {
      data: [],
      meta: { page: 1, pageSize: limit, total: 0, totalPages: 1, hasMore: false },
    };
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch company jobs: ${res.status}`);
  }
  const body = (await res.json()) as JobsApiResponse;
  return {
    ...body,
    data: (body.data ?? []).filter(isJobReady),
    meta: normalizeJobsListMeta(body.meta),
  };
}

export async function fetchJobById(
  id: string,
  opts?: {
    token?: string | null;
    forwardedFor?: string | null;
    signal?: AbortSignal | null;
    /** Server-only: forwarded to direct API when not using the Next proxy. */
    internalSeoSecret?: string | null;
  },
): Promise<JobDetailFetchResult | null> {
  const headers = new Headers();
  const t = opts?.token?.trim();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const isServer = typeof window === "undefined";

  /**
   * PRODUCTION-INTENT: Two-tier fetch strategy for job detail pages.
   *
   * Authenticated (has token): `no-store` — per-user metering stays accurate,
   *   `x-forwarded-for` is forwarded for IP chain attribution.
   *
   * Anonymous (no token): ISR-cached for 5 min — the internal SEO bypass tells
   *   Fastify to skip IP-based metering and return the full payload.  The
   *   `x-forwarded-for` header is intentionally omitted so all anonymous requests
   *   share one Next.js data-cache entry per job ID instead of one per visitor IP.
   *
   * This eliminates redundant upstream fetches for crawler/anonymous traffic while
   * keeping authenticated behaviour unchanged.
   */
  let fetchOptions: RequestInit & { next?: { revalidate?: number } };
  if (t) {
    const forwardedFor = opts?.forwardedFor?.trim();
    if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
    fetchOptions = { headers, cache: "no-store" };
  } else {
    const internalSeoSecret = opts?.internalSeoSecret?.trim() ?? process.env.INTERNAL_SEO_SECRET?.trim();
    if (internalSeoSecret) {
      headers.set("x-internal-seo", "true");
      headers.set("x-internal-seo-secret", internalSeoSecret);
    }
    fetchOptions = { headers, next: { revalidate: 300, tags: [jobDetailCacheTag(id)] } };
  }
  if (opts?.signal) fetchOptions.signal = opts.signal;

  const url = `${API_BASE_URL}/jobs/${encodeURIComponent(id)}`;
  const serverRetries = isServer ? 3 : 1;
  for (let attempt = 0; attempt < serverRetries; attempt++) {
    const res = await fetch(url, fetchOptions);
    if (res.status === 404) return null;
    const retryable = res.status === 429 || res.status === 503;
    if (retryable && attempt < serverRetries - 1) {
      await sleepMs(400 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch job ${id}: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as JobApiResponse;
    if (!payload.data) return null;
    if (!isJobReady(payload.data)) return null;
    return { data: payload.data, meta: payload.meta };
  }
  throw new Error(`Failed to fetch job ${id}: exhausted retries`);
}

/** OG-1.3: resolve a 301 target for a purged job id (`GET /jobs/:id/redirect`). */
export async function fetchJobRedirectPath(
  id: string,
  opts?: { signal?: AbortSignal | null },
): Promise<string | null> {
  const url = `${API_BASE_URL}/jobs/${encodeURIComponent(id)}/redirect`;
  const headers = new Headers();
  if (typeof window === "undefined") {
    const internalSeoSecret = process.env.INTERNAL_SEO_SECRET?.trim();
    if (internalSeoSecret) {
      headers.set("x-internal-seo", "true");
      headers.set("x-internal-seo-secret", internalSeoSecret);
    }
  }
  const res = await fetch(url, {
    headers,
    signal: opts?.signal ?? undefined,
    next: { revalidate: 300 },
  } as RequestInit & { next?: { revalidate?: number } });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { path?: string } };
  const path = body.data?.path?.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return null;
  }
  return path;
}

export type SemanticMatchMap = Record<string, { bullet: string; similarity: number }>;

export interface ResumeSemanticMatchMeta {
  tier: "free" | "pro";
  breakdownAllowed: boolean;
  quota: ResumeMatchAiQuotaState | null;
}

export interface ResumeSemanticMatchResponse {
  matches: SemanticMatchMap;
  matchMeta: ResumeSemanticMatchMeta;
}

export interface ApplicationJobSummary {
  id: string;
  title: string;
  companyName: string;
  companyLogo: string | null;
  locationCountry: string;
  workType: string;
  applyUrl: string;
}

export interface ApplicationListItem {
  id: string;
  status: string;
  appliedAt: string;
  lastActivityAt: string;
  archived: boolean;
  notes: string | null;
  job: ApplicationJobSummary;
}

export interface ApplicationCreateResponse {
  id: string;
  jobId: string;
  status: string;
  appliedAt: string;
  alreadyExisted: boolean;
}

export interface ApplicationStatsResponse {
  total: number;
  byStatus: Record<string, number>;
  needsAction: number;
}

export async function fetchApplications(
  token: string,
  query?: { status?: string; archived?: boolean | "true" | "false" },
): Promise<ApplicationListItem[]> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.archived !== undefined) {
    params.set("archived", String(query.archived));
  }

  const q = params.toString();
  const res = await fetch(`${API_BASE_URL}/applications${q ? `?${q}` : ""}`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to load applications", res.status, body.code);
  }
  return (await res.json()) as ApplicationListItem[];
}

export async function fetchApplicationStats(token: string): Promise<ApplicationStatsResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/applications/stats`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to load stats", res.status, body.code);
  }
  return (await res.json()) as ApplicationStatsResponse;
}

export async function createApplication(
  token: string,
  jobId: string,
): Promise<ApplicationCreateResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/applications`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to create application", res.status, body.code);
  }
  return (await res.json()) as ApplicationCreateResponse;
}

export async function patchApplicationStatus(
  token: string,
  id: string,
  status: string,
): Promise<void> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to update status", res.status, body.code);
  }
}

export async function patchApplicationNotes(
  token: string,
  id: string,
  notes: string | null,
): Promise<void> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(id)}/notes`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notes }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to save notes", res.status, body.code);
  }
}

export async function deleteApplication(token: string, id: string): Promise<void> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to delete", res.status, body.code);
  }
}

/** Batched semantic similarity between job keywords and resume bullets (Clerk JWT). */
export async function fetchResumeSemanticMatch(
  token: string,
  body: { keywords: string[]; bullets: string[] },
): Promise<ResumeSemanticMatchResponse> {
  const t = token.trim();
  if (!t) throw new ApiRequestError("Unauthorized", 401, "UNAUTHORIZED");

  const res = await fetch(`${API_BASE_URL}/account/resume/semantic-match`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
      limit?: number;
      used?: number;
      remaining?: number;
      resetAt?: string;
    };
    const quota =
      res.status === 429 &&
      errBody.code === "RESUME_MATCH_AI_QUOTA_EXCEEDED" &&
      typeof errBody.limit === "number" &&
      typeof errBody.used === "number" &&
      typeof errBody.remaining === "number" &&
      typeof errBody.resetAt === "string"
        ? {
            limit: errBody.limit,
            used: errBody.used,
            remaining: errBody.remaining,
            resetAt: errBody.resetAt,
          }
        : undefined;
    throw new ApiRequestError(
      errBody.message ?? errBody.error ?? "Semantic match failed",
      res.status,
      errBody.code,
      quota,
    );
  }
  const json = (await res.json()) as ResumeSemanticMatchResponse | SemanticMatchMap;
  if (json && typeof json === "object" && "matches" in json && "matchMeta" in json) {
    return json as ResumeSemanticMatchResponse;
  }
  return {
    matches: json as SemanticMatchMap,
    matchMeta: {
      tier: "pro",
      breakdownAllowed: true,
      quota: null,
    },
  };
}

export async function subscribeGrowthEmail(input: {
  email: string;
  source: "homepage" | "job_page" | "jobs_listing" | "exit_intent" | "extension";
  context?: { role?: string; location?: string; jobId?: string };
  token?: string | null;
}): Promise<{ success: boolean }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const t = input.token?.trim();
  if (t) {
    headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE_URL}/email/subscribe`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: input.email,
      source: input.source,
      context: input.context,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiRequestError(body.error ?? "Failed to subscribe", res.status, body.code);
  }
  return (await res.json()) as { success: boolean };
}
