import type { JobItem } from "./api";
import {
  getCanonicalsFromRequirementLine,
  getCanonicalsFromTextLine,
  normalizeKeywordForMatch,
} from "@jobseek/skill-constants";
import {
  isAcceptableResumeBigram,
  isScorableResumeKeyword,
  MAX_RESUME_MATCH_KEYWORDS,
} from "./resumeKeywordFilter";
import {
  extractJobSkills,
  jobSkillCanonicalsForSemantic,
  type JobSkill,
  type JobSkillSource,
} from "./skillExtractor";

/** Minimum signals before we treat a job as scorable (primary or fallback). */
export const MIN_JOB_MATCH_SIGNALS = 3;

const W_SPARSE_REQ = 0.65;
const W_SPARSE_RESP = 0.55;
const W_ROLE_HINT = 0.6;

const PHRASE_STOP = new Set(
  `a an the and or but if in on at to for of as is are was were be been being
it its this that these those we you our your they their them
will can could should would may must with from by not no
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** Business / PM phrases allowed in sparse JD fallback (not generic HR fluff). */
const SPARSE_FALLBACK_COMPOUNDS = new Set(
  `
user research
market research
go to market
a/b testing
ab testing
product discovery
customer discovery
cross functional
data driven
machine learning
deep learning
`
    .toLowerCase()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Single tokens for sparse fallback and role packs (bypass JOB_FLUFF in main filter). */
const SPARSE_FALLBACK_TOKENS = new Set(
  `
analytics sql python excel saas b2b b2c crm erp
agile scrum kanban jira confluence notion figma
tableau looker mixpanel amplitude segment
roadmap okrs kpi kpis seo sem ppc
salesforce hubspot zendesk intercom
kubernetes docker aws azure gcp
react typescript javascript nodejs postgresql mongodb redis
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

type RoleHintPack = { pattern: RegExp; skills: readonly string[] };

const ROLE_HINT_PACKS: RoleHintPack[] = [
  {
    pattern: /\bproduct\s*(manager|owner|lead)\b|\bpm\b/i,
    skills: [
      "analytics",
      "sql",
      "agile",
      "scrum",
      "jira",
      "figma",
      "user research",
      "saas",
      "roadmap",
      "notion",
    ],
  },
  {
    pattern: /\bdata\s*analyst\b|\banalytics\s*analyst\b/i,
    skills: ["sql", "python", "tableau", "looker", "analytics", "excel", "postgresql"],
  },
  {
    pattern: /\bmarketing\s*manager\b|\bdigital\s*marketing\b/i,
    skills: ["seo", "sem", "analytics", "hubspot", "salesforce", "ppc"],
  },
  {
    pattern: /\bproject\s*manager\b|\bprogram\s*manager\b/i,
    skills: ["agile", "scrum", "jira", "confluence", "roadmap", "kanban"],
  },
  {
    pattern: /\bcustomer\s*success\b|\baccount\s*manager\b/i,
    skills: ["salesforce", "crm", "zendesk", "hubspot", "analytics"],
  },
];

function cleanToken(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[.,;:!?'"()[\]{}]+/g, "")
    .replace(/[.,;:!?'"()[\]{}]+$/g, "")
    .trim();
}

function tokenizeLine(line: string): string[] {
  return line
    .replace(/[^a-zA-Z0-9\s\-+#./]/g, " ")
    .split(/\s+/)
    .map((w) => cleanToken(w))
    .filter((w) => w.length > 1 && !PHRASE_STOP.has(w));
}

function bigramsFromLine(line: string): string[] {
  const words = tokenizeLine(line);
  if (words.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i + 2 <= words.length; i++) {
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

export function isSparseFallbackKeyword(keyword: string): boolean {
  const k = normalizeKeywordForMatch(keyword);
  if (k.length < 2) return false;
  if (SPARSE_FALLBACK_COMPOUNDS.has(k)) return true;
  if (!k.includes(" ")) {
    return SPARSE_FALLBACK_TOKENS.has(k) || isScorableResumeKeyword(k);
  }
  const parts = k.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && isAcceptableResumeBigram(parts[0]!, parts[1]!)) {
    return SPARSE_FALLBACK_COMPOUNDS.has(k) || parts.every((p) => SPARSE_FALLBACK_TOKENS.has(p));
  }
  return isScorableResumeKeyword(k);
}

function mergeSkills(into: Map<string, JobSkill>, skills: JobSkill[]): void {
  for (const s of skills) {
    const prev = into.get(s.canonical);
    if (!prev || s.weight > prev.weight) into.set(s.canonical, s);
  }
}

function sortAndCap(skills: JobSkill[]): JobSkill[] {
  return [...skills]
    .sort((a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical))
    .slice(0, MAX_RESUME_MATCH_KEYWORDS);
}

function collectSparseFallbackSkills(job: JobItem): JobSkill[] {
  const byKey = new Map<string, JobSkill>();

  const add = (raw: string, source: JobSkillSource, weight: number) => {
    const key = normalizeKeywordForMatch(raw);
    if (!isSparseFallbackKeyword(key)) return;
    if (!byKey.has(key)) {
      byKey.set(key, { canonical: key, source, weight });
    }
  };

  for (const line of job.parsedDescription?.requirement ?? []) {
    for (const { canonical } of getCanonicalsFromRequirementLine(line)) {
      add(canonical, "sparse_requirement", W_SPARSE_REQ);
    }
    for (const token of tokenizeLine(line)) {
      add(token, "sparse_requirement", W_SPARSE_REQ);
    }
    for (const phrase of bigramsFromLine(line)) {
      add(phrase, "sparse_requirement", W_SPARSE_REQ);
    }
  }

  for (const line of job.parsedDescription?.responsibility ?? []) {
    for (const { canonical } of getCanonicalsFromRequirementLine(line)) {
      add(canonical, "sparse_responsibility", W_SPARSE_RESP);
    }
    for (const phrase of bigramsFromLine(line)) {
      add(phrase, "sparse_responsibility", W_SPARSE_RESP);
    }
  }

  for (const raw of job.skills ?? []) {
    for (const { canonical } of getCanonicalsFromTextLine(raw)) {
      add(canonical, "sparse_requirement", W_SPARSE_REQ);
    }
  }

  return [...byKey.values()];
}

function collectRoleHintSkills(job: JobItem): JobSkill[] {
  const haystack = `${job.title} ${job.role ?? ""}`.toLowerCase();
  const out: JobSkill[] = [];
  const seen = new Set<string>();

  for (const pack of ROLE_HINT_PACKS) {
    if (!pack.pattern.test(haystack)) continue;
    for (const skill of pack.skills) {
      const key = normalizeKeywordForMatch(skill);
      if (seen.has(key) || !isSparseFallbackKeyword(key)) continue;
      seen.add(key);
      out.push({ canonical: key, source: "role_hint", weight: W_ROLE_HINT });
    }
  }

  return out;
}

/**
 * Resolve scorable job signals: dictionary skills first, then sparse JD fallback, then title role hints.
 */
export function resolveJobMatchSkills(job: JobItem): JobSkill[] {
  const merged = new Map<string, JobSkill>();

  mergeSkills(merged, extractJobSkills(job));
  if (merged.size >= MIN_JOB_MATCH_SIGNALS) {
    return sortAndCap([...merged.values()]);
  }

  mergeSkills(merged, collectSparseFallbackSkills(job));
  if (merged.size >= MIN_JOB_MATCH_SIGNALS) {
    return sortAndCap([...merged.values()]);
  }

  mergeSkills(merged, collectRoleHintSkills(job));
  return sortAndCap([...merged.values()]);
}

/** Canonicals / keywords for semantic match API (stable order). */
export function jobMatchSignalsForSemantic(job: JobItem): string[] {
  return jobSkillCanonicalsForSemantic(resolveJobMatchSkills(job));
}

export function jobHasResolvableMatchSignals(job: JobItem): boolean {
  return resolveJobMatchSkills(job).length > 0;
}
