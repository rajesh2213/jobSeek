import type { JobFilters } from "./slug-parser";

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
  /** Canonical open roles (listing API only). */
  jobCount?: number;
  hasRemoteJobs?: boolean;
  lastCrawledAt?: string | null;
}

export interface CompanyDetail extends CompanyListItem {
  atsBoardToken: string | null;
  atsType: string | null;
  updatedAt: string;
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

export interface JobItem {
  id: string;
  title: string;
  description: string | null;
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
  sourceUrl: string;
  applyUrl?: string | null;
  postedAt: string | null;
  createdAt?: string;
  companyId: string;
  company: JobCompany;
}

export interface JobsApiResponse {
  data: JobItem[];
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalCount?: number;
    totalPages: number;
    offset?: number;
    hasMore?: boolean;
    capReached?: boolean;
    remaining?: number | null;
    resetAt?: string;
    totalHidden?: number;
    viewCapUnlimited?: boolean;
    company?: {
      id: string;
      name: string;
      slug: string;
      domain: string;
    };
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
    };
  };
}

interface CompanyApiResponse {
  data: CompanyDetail;
}

interface JobApiResponse {
  data: JobItem;
}

/**
 * Fastify API origin. Must point at the jobseek server, not the Next.js dev server:
 * same host/path as `/health` and `/locations/cities`. If Next runs on 3000, run
 * the API on another `PORT` and set `NEXT_PUBLIC_API_BASE_URL` (and `API_BASE_URL`
 * for SSR) to that origin, e.g. `http://127.0.0.1:3000`.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3000";

export interface AccountSummary {
  plan: "free" | "pro" | "pro_plus";
  jobViewsToday: number;
  jobViewsLimit: number | null;
  resetAt: string;
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

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Server or client: JobSeek usage stats (requires signed-in Clerk JWT). */
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
        ? ` Next import after ${new Date(err.resetAt).toLocaleString(undefined, { timeZone: "UTC" })} UTC.`
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
    throw new ApiRequestError(
      `Daily limit reached. Resets at ${err.resetAt ?? ""}`,
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
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.locations?.length) {
    params.set("locations", filters.locations.join(","));
  } else if (filters.location?.trim()) {
    params.set("location", filters.location.trim());
  } else if (filters.country?.trim()) {
    params.set("country", filters.country.trim());
  }
  if (filters.category) params.set("category", filters.category);
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

export async function fetchJobs(
  filters: JobFilters = {},
  opts?: {
    /** Clerk session JWT for per-user view caps. */
    token?: string | null;
    /** Server-only: must match API `JOB_LIST_VIEW_CAP_BYPASS_TOKEN` (e.g. sitemap). */
    viewCapBypassSecret?: string | null;
  },
): Promise<JobsApiResponse> {
  const params = buildJobDiscoverySearchParams(filters, { includeCompanyId: true });

  const url = `${API_BASE_URL}/jobs${params.toString() ? `?${params}` : ""}`;
  const headers = new Headers();
  const t = opts?.token?.trim();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const bypass = opts?.viewCapBypassSecret?.trim();
  if (bypass) headers.set("x-jobseek-view-cap-bypass", bypass);

  const res = await fetch(
    url,
    t
      ? { headers, cache: "no-store" }
      : { headers, next: { revalidate: 30 } },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as JobsApiResponse;
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
} = {}): Promise<CompaniesApiResponse> {
  const params = new URLSearchParams();
  if (options.page) params.set("page", String(options.page));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.sort && options.sort !== "jobs") params.set("sort", options.sort);
  if (options.hiring) params.set("hiring", "true");
  if (options.remote) params.set("remote", "true");
  const qs = params.toString();
  const url = `${API_BASE_URL}/companies${qs ? `?${qs}` : ""}`;
  const res = await fetch(
    url,
    typeof window === "undefined"
      ? { next: { revalidate: 60 } }
      : { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch companies: ${res.status}`);
  }
  return (await res.json()) as CompaniesApiResponse;
}

export async function fetchCompanyBySlug(slug: string): Promise<CompanyDetail | null> {
  const res = await fetch(`${API_BASE_URL}/company/${encodeURIComponent(slug)}`, {
    next: { revalidate: 120 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch company: ${res.status}`);
  }
  const payload = (await res.json()) as CompanyApiResponse;
  return payload.data;
}

export async function fetchCompanyJobs(
  slug: string,
  options: {
    page?: number;
    limit?: number;
    /** Same discovery filters as `/jobs`; `companyId` is ignored (route scopes by slug). */
    filters?: Omit<JobFilters, "companyId">;
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
  const res = await fetch(
    url,
    typeof window === "undefined"
      ? { next: { revalidate: 60 } }
      : { cache: "no-store" },
  );
  if (res.status === 404) {
    return {
      data: [],
      meta: { page: 1, limit, total: 0, totalPages: 1, hasMore: false },
    };
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch company jobs: ${res.status}`);
  }
  return (await res.json()) as JobsApiResponse;
}

export async function fetchJobById(id: string): Promise<JobItem | null> {
  const res = await fetch(`${API_BASE_URL}/jobs/${id}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch job ${id}: ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as JobApiResponse;
  return payload.data;
}

export type SemanticMatchMap = Record<string, { bullet: string; similarity: number }>;

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
): Promise<SemanticMatchMap> {
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
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiRequestError(
      errBody.message ?? errBody.error ?? "Semantic match failed",
      res.status,
      "SEMANTIC_MATCH_FAILED",
    );
  }
  return (await res.json()) as SemanticMatchMap;
}
