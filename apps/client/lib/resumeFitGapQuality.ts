import { isScorableResumeKeyword } from "./resumeKeywordFilter";

const FORBIDDEN_EXPLICIT = new Set([
  "contributor",
  "belonging",
  "audience",
  "seeking",
  "cloudinary",
  "monday",
  "associated",
  "authentic",
  "player",
  "industries",
  "participants",
  "screen",
  "study",
  "spanning",
  "dependencies",
  "suites",
  "phases",
  "discovery",
  "implement",
  "maintain",
  "integrated",
  "campaigns",
  "demonstrated",
  "comprehensive",
  "effective",
  "environment",
  "equivalent",
  "evidence",
  "expert",
  "expertise",
]);

const COMMON_VERBS = new Set(
  `build built building deliver drive create improve manage support ensure develop design lead analyze
communicate collaborate coordinate plan organize implement maintain monitor evaluate research write
read learn teach train hire recruit sell negotiate present report document review test debug deploy
operate install repair maintain troubleshoot schedule prioritize delegate mentor coach facilitate
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

const SOFTWARE_ONLY = new Set([
  "python",
  "sql",
  "kubernetes",
  "docker",
  "typescript",
  "javascript",
  "react",
  "postgres",
  "mongodb",
  "redis",
  "aws",
  "azure",
  "gcp",
  "tableau",
  "looker",
]);

export function isForbiddenExplicitOrVerb(keyword: string): boolean {
  const k = keyword.toLowerCase().trim();
  if (!k) return true;
  if (FORBIDDEN_EXPLICIT.has(k)) return true;
  if (COMMON_VERBS.has(k)) return true;
  return false;
}

export function isForbiddenGapToken(keyword: string): boolean {
  if (isForbiddenExplicitOrVerb(keyword)) return true;
  const k = keyword.toLowerCase().trim();
  if (!k.includes(" ") && !isScorableResumeKeyword(k)) {
    return true;
  }
  return false;
}

export function isSuspiciousSoftwareForTitle(title: string, keyword: string): boolean {
  const t = title.toLowerCase();
  if (!SOFTWARE_ONLY.has(keyword.toLowerCase())) return false;
  return (
    t.includes("recruiter") ||
    t.includes("therapist") ||
    t.includes("designer") ||
    t.includes("nurse") ||
    t.includes("sales")
  );
}

export function sanitizeGapKeyword(keyword: string, jobTitle = ""): string | null {
  if (isForbiddenGapToken(keyword)) return null;
  if (jobTitle && isSuspiciousSoftwareForTitle(jobTitle, keyword)) return null;
  return keyword;
}
