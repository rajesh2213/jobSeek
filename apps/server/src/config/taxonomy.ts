/**
 * Universal job taxonomy (multi-industry). Categories are controlled; roles are free-form slugs from titles.
 * Country data lives in `countries.ts` (ISO). Keep JOB_CATEGORIES in sync with `apps/client/lib/taxonomy.ts`.
 */

export const JOB_CATEGORIES = [
  "engineering",
  "product",
  "data",
  "management",
  "security",
  "infrastructure",
  "research",
  "content",
  "sales",
  "marketing",
  "design",
  "finance",
  "operations",
  "customer-support",
  "hr",
  "healthcare",
  "education",
  "legal",
  "other",
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(JOB_CATEGORIES);

// ---------------------------------------------------------------------------
// Alias safety classification
// ---------------------------------------------------------------------------

/**
 * Every alias MUST declare its safety mode:
 *
 *   "strict"       — Unambiguous technical term. Safe with word-boundary matching.
 *                     e.g. "typescript", "kubernetes", "postgresql"
 *
 *   "short-allow"  — Alias < MIN_ALIAS_LENGTH chars but explicitly vetted as safe
 *                     because it is a widely-recognized technical abbreviation that
 *                     rarely collides with English words.
 *                     e.g. "k8s", "aws", "gcp", "php", "sql", "vue"
 *
 *   "phrase"        — Multi-word phrase. Always safe because multi-word phrases
 *                     almost never occur as accidental substrings.
 *                     e.g. "amazon web services", "spring boot"
 *
 * BANNED modes (never use):
 *   "unsafe-common-word" — Common English word that collides even with word
 *                          boundaries: "go", "react", "node", "next", "support",
 *                          "spring", "elastic", "swift". NEVER add these.
 */
export type AliasMode = "strict" | "short-allow" | "phrase";

export interface SkillAliasEntry {
  alias: string;
  canonical: string;
  mode: AliasMode;
}

/**
 * Minimum alias length. Any alias shorter than this MUST use mode "short-allow"
 * to prove a human explicitly reviewed it. This prevents future regressions from
 * casually adding 1–2 char aliases like "go", "ts", "ai", "c", "r".
 */
export const MIN_ALIAS_LENGTH = 3;

/**
 * Authoritative alias registry with explicit safety classification.
 *
 * Rules for contributors:
 *  1. Aliases < MIN_ALIAS_LENGTH chars → mode MUST be "short-allow".
 *  2. Multi-word aliases (contain a space) → mode SHOULD be "phrase".
 *  3. Single common English words → DO NOT ADD (see banned list above).
 *  4. When in doubt, use a longer alias (e.g. "golang" not "go").
 */
export const SKILL_ALIAS_ENTRIES: readonly SkillAliasEntry[] = [
  // Cloud
  { alias: "aws",                   canonical: "aws",              mode: "short-allow" },
  { alias: "amazon web services",   canonical: "aws",              mode: "phrase" },
  { alias: "gcp",                   canonical: "gcp",              mode: "short-allow" },
  { alias: "google cloud",          canonical: "gcp",              mode: "phrase" },
  { alias: "google cloud platform", canonical: "gcp",              mode: "phrase" },
  { alias: "azure",                 canonical: "azure",            mode: "strict" },
  { alias: "microsoft azure",       canonical: "azure",            mode: "phrase" },
  { alias: "terraform",             canonical: "terraform",        mode: "strict" },
  { alias: "cloudformation",        canonical: "cloudformation",   mode: "strict" },
  { alias: "cloud formation",       canonical: "cloudformation",   mode: "phrase" },
  { alias: "pulumi",                canonical: "pulumi",           mode: "strict" },

  // Backend / languages
  { alias: "node.js",               canonical: "nodejs",           mode: "strict" },
  { alias: "nodejs",                canonical: "nodejs",           mode: "strict" },
  { alias: "python",                canonical: "python",           mode: "strict" },
  { alias: "java",                  canonical: "java",             mode: "strict" },
  { alias: "golang",                canonical: "golang",           mode: "strict" },
  { alias: "rust",                  canonical: "rust",             mode: "strict" },
  { alias: "ruby",                  canonical: "ruby",             mode: "strict" },
  { alias: "php",                   canonical: "php",              mode: "short-allow" },
  { alias: "scala",                 canonical: "scala",            mode: "strict" },
  { alias: "kotlin",                canonical: "kotlin",           mode: "strict" },
  { alias: "fastapi",               canonical: "fastapi",          mode: "strict" },
  { alias: "fast api",              canonical: "fastapi",          mode: "phrase" },
  { alias: "django",                canonical: "django",           mode: "strict" },
  { alias: "spring boot",           canonical: "spring",           mode: "phrase" },
  { alias: "spring framework",      canonical: "spring",           mode: "phrase" },

  // Frontend
  { alias: "react.js",              canonical: "react",            mode: "strict" },
  { alias: "reactjs",               canonical: "react",            mode: "strict" },
  { alias: "vue",                   canonical: "vue",              mode: "short-allow" },
  { alias: "vue.js",                canonical: "vue",              mode: "strict" },
  { alias: "angular",               canonical: "angular",          mode: "strict" },
  { alias: "nextjs",                canonical: "nextjs",           mode: "strict" },
  { alias: "next.js",               canonical: "nextjs",           mode: "strict" },
  { alias: "svelte",                canonical: "svelte",           mode: "strict" },
  { alias: "tailwind",              canonical: "tailwind",         mode: "strict" },
  { alias: "tailwindcss",           canonical: "tailwind",         mode: "strict" },
  { alias: "graphql",               canonical: "graphql",          mode: "strict" },
  { alias: "graph ql",              canonical: "graphql",          mode: "phrase" },

  // Data / ML
  { alias: "pytorch",               canonical: "pytorch",          mode: "strict" },
  { alias: "py torch",              canonical: "pytorch",          mode: "phrase" },
  { alias: "tensorflow",            canonical: "tensorflow",       mode: "strict" },
  { alias: "apache spark",          canonical: "spark",            mode: "phrase" },
  { alias: "pyspark",               canonical: "spark",            mode: "strict" },
  { alias: "kafka",                 canonical: "kafka",            mode: "strict" },
  { alias: "airflow",               canonical: "airflow",          mode: "strict" },
  { alias: "apache airflow",        canonical: "airflow",          mode: "phrase" },
  { alias: "snowflake",             canonical: "snowflake",        mode: "strict" },
  { alias: "databricks",            canonical: "databricks",       mode: "strict" },
  { alias: "pandas",                canonical: "pandas",           mode: "strict" },
  { alias: "scikit-learn",          canonical: "scikit-learn",     mode: "strict" },
  { alias: "sklearn",               canonical: "scikit-learn",     mode: "strict" },
  { alias: "huggingface",           canonical: "huggingface",      mode: "strict" },
  { alias: "hugging face",          canonical: "huggingface",      mode: "phrase" },

  // Databases
  { alias: "postgres",              canonical: "postgres",         mode: "strict" },
  { alias: "postgresql",            canonical: "postgres",         mode: "strict" },
  { alias: "mysql",                 canonical: "mysql",            mode: "strict" },
  { alias: "mongodb",               canonical: "mongodb",          mode: "strict" },
  { alias: "mongo",                 canonical: "mongodb",          mode: "strict" },
  { alias: "redis",                 canonical: "redis",            mode: "strict" },
  { alias: "elasticsearch",         canonical: "elasticsearch",    mode: "strict" },
  { alias: "dynamodb",              canonical: "dynamodb",         mode: "strict" },
  { alias: "dynamo db",             canonical: "dynamodb",         mode: "phrase" },
  { alias: "bigquery",              canonical: "bigquery",         mode: "strict" },
  { alias: "big query",             canonical: "bigquery",         mode: "phrase" },

  // DevOps
  { alias: "kubernetes",            canonical: "kubernetes",       mode: "strict" },
  { alias: "k8s",                   canonical: "kubernetes",       mode: "short-allow" },
  { alias: "docker",                canonical: "docker",           mode: "strict" },
  { alias: "jenkins",               canonical: "jenkins",          mode: "strict" },
  { alias: "github actions",        canonical: "github-actions",   mode: "phrase" },
  { alias: "github-actions",        canonical: "github-actions",   mode: "strict" },
  { alias: "ansible",               canonical: "ansible",          mode: "strict" },
  { alias: "prometheus",            canonical: "prometheus",       mode: "strict" },
  { alias: "grafana",               canonical: "grafana",          mode: "strict" },

  // Mobile
  { alias: "android",               canonical: "android",          mode: "strict" },
  { alias: "react native",          canonical: "react-native",     mode: "phrase" },
  { alias: "react-native",          canonical: "react-native",     mode: "strict" },
  { alias: "flutter",               canonical: "flutter",          mode: "strict" },

  // Other tools
  { alias: "figma",                 canonical: "figma",            mode: "strict" },
  { alias: "salesforce",            canonical: "salesforce",       mode: "strict" },
  { alias: "jira",                  canonical: "jira",             mode: "strict" },
  { alias: "tableau",               canonical: "tableau",          mode: "strict" },
  { alias: "powerbi",               canonical: "powerbi",          mode: "strict" },
  { alias: "power bi",              canonical: "powerbi",          mode: "phrase" },
  { alias: "linux",                 canonical: "linux",            mode: "strict" },

  // Languages / tools (general)
  { alias: "typescript",            canonical: "typescript",       mode: "strict" },
  { alias: "sql",                   canonical: "sql",              mode: "short-allow" },
  { alias: "excel",                 canonical: "excel",            mode: "strict" },

  // Soft / domain
  { alias: "customer service",      canonical: "customer-support", mode: "phrase" },
  { alias: "customer support",      canonical: "customer-support", mode: "phrase" },
  { alias: "customer-support",      canonical: "customer-support", mode: "strict" },
  { alias: "recruiting",            canonical: "recruiting",       mode: "strict" },
  { alias: "project management",    canonical: "project-management", mode: "phrase" },
  { alias: "project-management",    canonical: "project-management", mode: "strict" },
  { alias: "agile",                 canonical: "agile",            mode: "strict" },
  { alias: "scrum",                 canonical: "scrum",            mode: "strict" },
  { alias: "negotiation",           canonical: "negotiation",      mode: "strict" },
  { alias: "accounting",            canonical: "accounting",       mode: "strict" },
  { alias: "bookkeeping",           canonical: "bookkeeping",      mode: "strict" },
  { alias: "nursing",               canonical: "nursing",          mode: "strict" },
  { alias: "teaching",              canonical: "teaching",         mode: "strict" },
  { alias: "counseling",            canonical: "counseling",       mode: "strict" },
];

// ---------------------------------------------------------------------------
// Build-time validation — runs once at module load, fails fast on violations
// ---------------------------------------------------------------------------

for (const entry of SKILL_ALIAS_ENTRIES) {
  const len = entry.alias.replace(/[.\-#]/g, "").length;
  if (len < MIN_ALIAS_LENGTH && entry.mode !== "short-allow") {
    throw new Error(
      `SKILL_ALIAS_ENTRIES: alias "${entry.alias}" is ${len} chars (< MIN_ALIAS_LENGTH=${MIN_ALIAS_LENGTH}) ` +
      `but mode is "${entry.mode}". Short aliases MUST use mode "short-allow" to confirm they were explicitly vetted.`,
    );
  }
  if (entry.alias.includes(" ") && entry.mode !== "phrase" && entry.mode !== "short-allow") {
    throw new Error(
      `SKILL_ALIAS_ENTRIES: multi-word alias "${entry.alias}" should use mode "phrase", got "${entry.mode}".`,
    );
  }
}

/**
 * Runtime alias map — flat Record derived from the structured registry.
 * Downstream code (taxonomyNormalizer, client taxonomy) consumes this shape.
 */
export const SKILL_ALIAS_MAP: Record<string, string> = Object.fromEntries(
  SKILL_ALIAS_ENTRIES.map((e) => [e.alias, e.canonical]),
);

/**
 * Occupation-domain contradiction filter.
 *
 * When the job title signals a clearly non-technical occupation, these skill slugs
 * are suppressed from extraction. The lookup is O(1) per skill (Set membership).
 *
 * This is a SAFETY NET — the primary fix is word-boundary–aware matching. This
 * catches residual false positives from legitimate English words ("react", "rust").
 */
export const DOMAIN_CONTRADICTION_TITLE_RE =
  /\b(phlebotom|nurse|nursing|physician|doctor|dental|dentist|pharmacist|therapist|radiolog|sonograph|cna\b|lpn\b|rn\b|medical\s+assist|surgeon|anesthesi|patholog|optometr|chiropract|midwife|emt\b|paramedic|veterinar|custodian|janitor|cashier|barista|waiter|waitress|dishwasher|housekeeper|lifeguard|nanny|babysit)/i;

export const SOFTWARE_ONLY_SKILL_SLUGS: ReadonlySet<string> = new Set([
  "aws", "gcp", "azure", "terraform", "cloudformation", "pulumi",
  "nodejs", "golang", "rust", "ruby", "php", "scala", "kotlin",
  "fastapi", "django", "spring",
  "react", "vue", "angular", "nextjs", "svelte", "tailwind", "graphql",
  "pytorch", "tensorflow", "spark", "kafka", "airflow",
  "databricks", "huggingface",
  "postgres", "mysql", "mongodb", "redis", "elasticsearch", "dynamodb", "bigquery",
  "kubernetes", "k8s", "docker", "jenkins", "github-actions", "ansible", "prometheus", "grafana",
  "android", "react-native", "flutter",
  "typescript",
]);

export function isValidJobCategory(slug: string): slug is JobCategory {
  return CATEGORY_SET.has(slug);
}

/** Canonical skill slugs = values of SKILL_ALIAS_MAP (unique). */
export const KNOWN_SKILL_SLUGS = Array.from(new Set(Object.values(SKILL_ALIAS_MAP))).sort();

export function isKnownSkillSlug(slug: string): boolean {
  return KNOWN_SKILL_SLUGS.includes(slug);
}
