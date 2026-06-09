/**
 * Universal job taxonomy (multi-industry). Categories are controlled; roles are free-form slugs from titles.
 * Country data lives in `countries.ts` (ISO). Keep JOB_CATEGORIES in sync with `apps/client/lib/taxonomy.ts`.
 *
 * Skill ontology: `@jobseek/skill-constants/taxonomy` (single source of truth).
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

export {
  MIN_ALIAS_LENGTH,
  SKILL_ALIAS_ENTRIES,
  SKILL_ALIAS_MAP,
  KNOWN_SKILL_SLUGS,
  isKnownSkillSlug,
  type AliasMode,
  type SkillAliasEntry,
} from "@jobseek/skill-constants/taxonomy";

/**
 * Occupation-domain contradiction filter.
 *
 * When the job title signals a clearly non-technical occupation, these skill slugs
 * are suppressed from extraction. The lookup is O(1) per skill (Set membership).
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
