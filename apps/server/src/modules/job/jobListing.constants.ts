/**
 * Canonical jobs with these `role` slugs are hidden from all job listings (not deleted).
 * Keep in sync with role-suggestion exclusions where applicable.
 */
export const LISTING_EXCLUDED_ROLE_SLUGS: readonly string[] = [
  "job-role",
  "careers",
  "jobs",
  "job",
  "all",
  "benefits",
  "open-roles",
  "career-search",
  "searchcareer",
  "career-areas",
];

/**
 * Max characters for `description` on GET /jobs list JSON (truncate only; never omit the field).
 * Preview lines use parsed/description server-side before truncation for serialization.
 */
export const LIST_JOB_DESCRIPTION_MAX_CHARS = 1200;

/**
 * Max `description` bytes read from Postgres for listing preview generation.
 * Not serialized on the wire when `previewLines` are present; keeps Supabase I/O bounded.
 */
export const LIST_JOB_HYDRATE_DESCRIPTION_MAX_CHARS = 8192;

/** Extra slugs excluded only from GET /jobs/roles suggestions (broader junk). */
export const ROLE_SUGGEST_EXTRA_EXCLUDED: readonly string[] = [
  "culture",
  "locations",
  "teams",
  "life-at",
  "old-navy-careers",
];
