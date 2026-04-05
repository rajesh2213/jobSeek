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

/** Extra slugs excluded only from GET /jobs/roles suggestions (broader junk). */
export const ROLE_SUGGEST_EXTRA_EXCLUDED: readonly string[] = [
  "culture",
  "locations",
  "teams",
  "life-at",
  "old-navy-careers",
];
