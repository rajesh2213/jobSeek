/**
 * Authoritative skill alias registry — single source of truth for JobLoom ontology.
 * Consumed by server ingestion, client resume match, and dictionary generator.
 */

export type AliasMode = "strict" | "short-allow" | "phrase";

export interface SkillAliasEntry {
  alias: string;
  canonical: string;
  mode: AliasMode;
}

export const MIN_ALIAS_LENGTH = 3;

/**
 * Every alias MUST declare its safety mode:
 *
 *   "strict"       — Unambiguous technical term. Safe with word-boundary matching.
 *   "short-allow"  — Alias < MIN_ALIAS_LENGTH chars but explicitly vetted as safe.
 *   "phrase"       — Multi-word phrase. Always safe.
 *
 * BANNED (never add as bare aliases): go, react, node, next, spring, elastic, swift, support.
 */
export const SKILL_ALIAS_ENTRIES: readonly SkillAliasEntry[] = [
  // Cloud
  { alias: "aws", canonical: "aws", mode: "short-allow" },
  { alias: "amazon web services", canonical: "aws", mode: "phrase" },
  { alias: "gcp", canonical: "gcp", mode: "short-allow" },
  { alias: "google cloud", canonical: "gcp", mode: "phrase" },
  { alias: "google cloud platform", canonical: "gcp", mode: "phrase" },
  { alias: "azure", canonical: "azure", mode: "strict" },
  { alias: "microsoft azure", canonical: "azure", mode: "phrase" },
  { alias: "terraform", canonical: "terraform", mode: "strict" },
  { alias: "cloudformation", canonical: "cloudformation", mode: "strict" },
  { alias: "cloud formation", canonical: "cloudformation", mode: "phrase" },
  { alias: "pulumi", canonical: "pulumi", mode: "strict" },

  // Backend / languages
  { alias: "node.js", canonical: "nodejs", mode: "strict" },
  { alias: "nodejs", canonical: "nodejs", mode: "strict" },
  { alias: "python", canonical: "python", mode: "strict" },
  { alias: "java", canonical: "java", mode: "strict" },
  { alias: "golang", canonical: "golang", mode: "strict" },
  { alias: "rust", canonical: "rust", mode: "strict" },
  { alias: "ruby", canonical: "ruby", mode: "strict" },
  { alias: "php", canonical: "php", mode: "short-allow" },
  { alias: "scala", canonical: "scala", mode: "strict" },
  { alias: "kotlin", canonical: "kotlin", mode: "strict" },
  { alias: "fastapi", canonical: "fastapi", mode: "strict" },
  { alias: "fast api", canonical: "fastapi", mode: "phrase" },
  { alias: "django", canonical: "django", mode: "strict" },
  { alias: "spring boot", canonical: "spring", mode: "phrase" },
  { alias: "spring framework", canonical: "spring", mode: "phrase" },

  // Frontend
  { alias: "react.js", canonical: "react", mode: "strict" },
  { alias: "reactjs", canonical: "react", mode: "strict" },
  { alias: "vue", canonical: "vue", mode: "short-allow" },
  { alias: "vue.js", canonical: "vue", mode: "strict" },
  { alias: "angular", canonical: "angular", mode: "strict" },
  { alias: "nextjs", canonical: "nextjs", mode: "strict" },
  { alias: "next.js", canonical: "nextjs", mode: "strict" },
  { alias: "svelte", canonical: "svelte", mode: "strict" },
  { alias: "tailwind", canonical: "tailwind", mode: "strict" },
  { alias: "tailwindcss", canonical: "tailwind", mode: "strict" },
  { alias: "graphql", canonical: "graphql", mode: "strict" },
  { alias: "graph ql", canonical: "graphql", mode: "phrase" },

  // Data / ML
  { alias: "pytorch", canonical: "pytorch", mode: "strict" },
  { alias: "py torch", canonical: "pytorch", mode: "phrase" },
  { alias: "tensorflow", canonical: "tensorflow", mode: "strict" },
  { alias: "apache spark", canonical: "spark", mode: "phrase" },
  { alias: "pyspark", canonical: "spark", mode: "strict" },
  { alias: "kafka", canonical: "kafka", mode: "strict" },
  { alias: "airflow", canonical: "airflow", mode: "strict" },
  { alias: "apache airflow", canonical: "airflow", mode: "phrase" },
  { alias: "snowflake", canonical: "snowflake", mode: "strict" },
  { alias: "databricks", canonical: "databricks", mode: "strict" },
  { alias: "pandas", canonical: "pandas", mode: "strict" },
  { alias: "scikit-learn", canonical: "scikit-learn", mode: "strict" },
  { alias: "sklearn", canonical: "scikit-learn", mode: "strict" },
  { alias: "huggingface", canonical: "huggingface", mode: "strict" },
  { alias: "hugging face", canonical: "huggingface", mode: "phrase" },

  // Databases
  { alias: "postgres", canonical: "postgres", mode: "strict" },
  { alias: "postgresql", canonical: "postgres", mode: "strict" },
  { alias: "mysql", canonical: "mysql", mode: "strict" },
  { alias: "mongodb", canonical: "mongodb", mode: "strict" },
  { alias: "mongo", canonical: "mongodb", mode: "strict" },
  { alias: "redis", canonical: "redis", mode: "strict" },
  { alias: "elasticsearch", canonical: "elasticsearch", mode: "strict" },
  { alias: "dynamodb", canonical: "dynamodb", mode: "strict" },
  { alias: "dynamo db", canonical: "dynamodb", mode: "phrase" },
  { alias: "bigquery", canonical: "bigquery", mode: "strict" },
  { alias: "big query", canonical: "bigquery", mode: "phrase" },

  // DevOps
  { alias: "kubernetes", canonical: "kubernetes", mode: "strict" },
  { alias: "k8s", canonical: "kubernetes", mode: "short-allow" },
  { alias: "docker", canonical: "docker", mode: "strict" },
  { alias: "jenkins", canonical: "jenkins", mode: "strict" },
  { alias: "github actions", canonical: "github-actions", mode: "phrase" },
  { alias: "github-actions", canonical: "github-actions", mode: "strict" },
  { alias: "ansible", canonical: "ansible", mode: "strict" },
  { alias: "prometheus", canonical: "prometheus", mode: "strict" },
  { alias: "grafana", canonical: "grafana", mode: "strict" },

  // Mobile
  { alias: "android", canonical: "android", mode: "strict" },
  { alias: "react native", canonical: "react-native", mode: "phrase" },
  { alias: "react-native", canonical: "react-native", mode: "strict" },
  { alias: "flutter", canonical: "flutter", mode: "strict" },

  // Other tools
  { alias: "figma", canonical: "figma", mode: "strict" },
  { alias: "salesforce", canonical: "salesforce", mode: "strict" },
  { alias: "jira", canonical: "jira", mode: "strict" },
  { alias: "tableau", canonical: "tableau", mode: "strict" },
  { alias: "powerbi", canonical: "powerbi", mode: "strict" },
  { alias: "power bi", canonical: "powerbi", mode: "phrase" },
  { alias: "linux", canonical: "linux", mode: "strict" },

  // Languages / tools (general)
  { alias: "typescript", canonical: "typescript", mode: "strict" },
  { alias: "sql", canonical: "sql", mode: "short-allow" },
  { alias: "excel", canonical: "excel", mode: "strict" },

  // Soft / domain
  { alias: "customer service", canonical: "customer-support", mode: "phrase" },
  { alias: "customer support", canonical: "customer-support", mode: "phrase" },
  { alias: "customer-support", canonical: "customer-support", mode: "strict" },
  { alias: "recruiting", canonical: "recruiting", mode: "strict" },
  { alias: "project management", canonical: "project-management", mode: "phrase" },
  { alias: "project-management", canonical: "project-management", mode: "strict" },
  { alias: "agile", canonical: "agile", mode: "strict" },
  { alias: "scrum", canonical: "scrum", mode: "strict" },
  { alias: "negotiation", canonical: "negotiation", mode: "strict" },
  { alias: "accounting", canonical: "accounting", mode: "strict" },
  { alias: "bookkeeping", canonical: "bookkeeping", mode: "strict" },
  { alias: "nursing", canonical: "nursing", mode: "strict" },
  { alias: "teaching", canonical: "teaching", mode: "strict" },
  { alias: "counseling", canonical: "counseling", mode: "strict" },
];
