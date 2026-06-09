/**
 * Job categories + skill slugs for client routing. Skill ontology from `@jobseek/skill-constants/taxonomy`.
 * Keep JOB_CATEGORIES in sync with `apps/server/src/config/taxonomy.ts`.
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

export {
  SKILL_ALIAS_MAP,
  KNOWN_SKILL_SLUGS,
  isKnownSkillSlug,
} from "@jobseek/skill-constants/taxonomy";
