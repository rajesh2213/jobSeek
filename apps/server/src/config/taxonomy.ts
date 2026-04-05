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

/**
 * Multi-domain skill aliases → canonical slug (lowercase, hyphenated).
 * Matching is done via substring match with longest aliases first in `taxonomyNormalizer`.
 */
export const SKILL_ALIAS_MAP: Record<string, string> = {
  // Cloud
  aws: "aws",
  "amazon web services": "aws",
  amazon: "aws",
  gcp: "gcp",
  "google cloud": "gcp",
  "google cloud platform": "gcp",
  azure: "azure",
  "microsoft azure": "azure",
  terraform: "terraform",
  cloudformation: "cloudformation",
  "cloud formation": "cloudformation",
  pulumi: "pulumi",

  // Backend / languages
  "node.js": "nodejs",
  nodejs: "nodejs",
  node: "nodejs",
  python: "python",
  java: "java",
  golang: "golang",
  go: "golang",
  rust: "rust",
  ruby: "ruby",
  php: "php",
  scala: "scala",
  kotlin: "kotlin",
  fastapi: "fastapi",
  "fast api": "fastapi",
  django: "django",
  spring: "spring",
  "spring boot": "spring",

  // Frontend
  "react.js": "react",
  react: "react",
  vue: "vue",
  "vue.js": "vue",
  angular: "angular",
  nextjs: "nextjs",
  "next.js": "nextjs",
  next: "nextjs",
  svelte: "svelte",
  tailwind: "tailwind",
  tailwindcss: "tailwind",
  graphql: "graphql",
  "graph ql": "graphql",

  // Data / ML
  pytorch: "pytorch",
  "py torch": "pytorch",
  tensorflow: "tensorflow",
  spark: "spark",
  "apache spark": "spark",
  kafka: "kafka",
  airflow: "airflow",
  "apache airflow": "airflow",
  dbt: "dbt",
  snowflake: "snowflake",
  databricks: "databricks",
  pandas: "pandas",
  "scikit-learn": "scikit-learn",
  sklearn: "scikit-learn",
  scikit: "scikit-learn",
  huggingface: "huggingface",
  "hugging face": "huggingface",

  // Databases
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  elasticsearch: "elasticsearch",
  elastic: "elasticsearch",
  dynamodb: "dynamodb",
  "dynamo db": "dynamodb",
  bigquery: "bigquery",
  "big query": "bigquery",

  // DevOps
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  docker: "docker",
  jenkins: "jenkins",
  "github actions": "github-actions",
  "github-actions": "github-actions",
  ansible: "ansible",
  prometheus: "prometheus",
  grafana: "grafana",

  // Mobile
  ios: "ios",
  android: "android",
  "react native": "react-native",
  "react-native": "react-native",
  flutter: "flutter",
  swift: "swift",

  // Other tools
  figma: "figma",
  salesforce: "salesforce",
  jira: "jira",
  tableau: "tableau",
  powerbi: "powerbi",
  "power bi": "powerbi",
  sap: "sap",
  linux: "linux",

  // Typescript / existing
  typescript: "typescript",
  ts: "typescript",
  sql: "sql",
  excel: "excel",

  // Soft / domain
  "customer service": "customer-support",
  support: "customer-support",
  "customer-support": "customer-support",
  recruiting: "recruiting",
  "project management": "project-management",
  "project-management": "project-management",
  agile: "agile",
  scrum: "scrum",

  negotiation: "negotiation",
  accounting: "accounting",
  bookkeeping: "bookkeeping",
  nursing: "nursing",
  teaching: "teaching",
  counseling: "counseling",
};

export function isValidJobCategory(slug: string): slug is JobCategory {
  return CATEGORY_SET.has(slug);
}

/** Canonical skill slugs = values of SKILL_ALIAS_MAP (unique). */
export const KNOWN_SKILL_SLUGS = Array.from(new Set(Object.values(SKILL_ALIAS_MAP))).sort();

export function isKnownSkillSlug(slug: string): boolean {
  return KNOWN_SKILL_SLUGS.includes(slug);
}
