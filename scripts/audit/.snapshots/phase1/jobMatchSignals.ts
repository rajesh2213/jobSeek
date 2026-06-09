import type { JobItem } from "../../../../apps/client/lib/api.ts";
import {
  confidenceForFitTier,
  type FitConfidence,
  type FitSignalMetadata,
  type FitTier,
  type FitUnavailableReason,
} from "../../../../apps/client/lib/resumeFitConfidence.ts";
import {
  getCanonicalsFromRequirementLine,
  getCanonicalsFromTextLine,
  normalizeKeywordForMatch,
} from "./index.ts";
import {
  isAcceptableResumeBigram,
  isScorableResumeKeyword,
  MAX_RESUME_MATCH_KEYWORDS,
} from "../../../../apps/client/lib/resumeKeywordFilter.ts";
import {
  extractJobSkills,
  jobSkillCanonicalsForSemantic,
  type JobSkill,
  type JobSkillSource,
} from "../../../../apps/client/lib/skillExtractor.ts";

/** Minimum signals before we treat a job as scorable (primary or fallback). */
export const MIN_JOB_MATCH_SIGNALS = 3;

/** Minimum plain-text description length to attempt fit scoring. */
const MIN_DESCRIPTION_CHARS = 10;

const W_SPARSE_REQ = 0.65;
const W_SPARSE_RESP = 0.55;
const W_DESCRIPTION = 0.55;
const W_ROLE_HINT = 0.6;
const W_TITLE_FAMILY = 0.55;

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
patient care
health insurance
medical billing
sales pipeline
quality control
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
recruiting negotiation accounting healthcare compliance
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
  {
    pattern:
      /\b(software|backend|frontend|full[\s-]?stack|platform|devops|sre|site\s*reliability|ml|machine\s*learning)\s*(engineer|developer|architect)\b/i,
    skills: ["software development", "git", "agile", "testing", "python", "sql"],
  },
  {
    pattern: /\b(data\s*engineer|data\s*scientist|analytics\s*engineer)\b/i,
    skills: ["python", "sql", "analytics", "machine learning", "postgresql"],
  },
  {
    pattern:
      /\b(account\s*executive|sales\s*(representative|rep|executive)|business\s*development|bdr\b|sdr\b|field\s*sales)\b/i,
    skills: ["sales pipeline", "crm", "negotiation", "customer relationships", "excel"],
  },
  {
    pattern: /\b(sales\s*associate|retail\s*associate|store\s*associate|cashier)\b/i,
    skills: ["retail sales", "customer service", "inventory", "point of sale"],
  },
  {
    pattern:
      /\b(patient\s*access|medical\s*records|health\s*information|prior\s*auth|registration\s*clerk|intake\s*coordinator)\b/i,
    skills: ["patient registration", "medical billing", "health insurance", "customer service"],
  },
  {
    pattern:
      /\b(physical\s*therapist|occupational\s*therapist|registered\s*nurse|rn\b|nurse\s*practitioner|clinical|therapist|pharmacist)\b/i,
    skills: ["patient care", "clinical documentation", "healthcare compliance", "medical records"],
  },
  {
    pattern: /\b(recruiter|talent\s*acquisition|hr\s*generalist|human\s*resources)\b/i,
    skills: ["recruiting", "interviewing", "applicant tracking", "onboarding"],
  },
  {
    pattern: /\b(consultant|consulting|advisory|advisor|adviser)\b/i,
    skills: ["client engagement", "stakeholder management", "analytics", "communication"],
  },
  {
    pattern:
      /\b(program\s*officer|project\s*officer|implementation\s*officer|field\s*officer|monitoring\s*officer)\b/i,
    skills: ["project coordination", "stakeholder management", "reporting", "communication"],
  },
  {
    pattern: /\b(producer|production\s*coordinator|studio\s*producer|multimedia\s*producer)\b/i,
    skills: ["project coordination", "content production", "communication", "planning"],
  },
  {
    pattern: /\b(customer\s*(service|support|experience)|call\s*center|contact\s*center)\b/i,
    skills: ["customer service", "conflict resolution", "crm", "communication"],
  },
  {
    pattern: /\b(assembler|warehouse|machine\s*operator|production\s*worker|manufacturing)\b/i,
    skills: ["quality control", "safety procedures", "production line", "inventory"],
  },
  {
    pattern: /\bintern\b/i,
    skills: ["communication", "team collaboration", "learning agility", "microsoft office"],
  },
  {
    pattern:
      /\b(supervisor|team\s*lead|coordinator|specialist|director|manager|executive|officer)\b/i,
    skills: ["team leadership", "project coordination", "communication", "planning"],
  },
];

export interface JobMatchResolution {
  skills: JobSkill[];
  fitTier: FitTier | null;
  confidence: FitConfidence | null;
  signalCount: number;
  sourceBreakdown: FitSignalMetadata["sourceBreakdown"];
  unavailableReason: FitUnavailableReason | null;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedJobDescription(raw: string | null | undefined): string {
  return stripHtml(raw ?? "");
}

/** Text corpus for fit signals: full description, card previews, then parsed buckets. */
export function jobDescriptionCorpus(job: JobItem): string {
  const chunks: string[] = [];
  const desc = normalizedJobDescription(job.description);
  if (desc.length >= MIN_DESCRIPTION_CHARS) chunks.push(desc);
  if (job.previewLines?.length) {
    chunks.push(job.previewLines.map((line) => stripHtml(line)).join("\n"));
  }
  const pd = job.parsedDescription;
  if (pd) {
    for (const line of pd.requirement ?? []) chunks.push(line);
    for (const line of pd.responsibility ?? []) chunks.push(line);
    for (const line of pd.experience ?? []) chunks.push(line);
    for (const line of pd.position ?? []) chunks.push(line);
    for (const line of pd.other ?? []) chunks.push(line);
  }
  return chunks.join("\n").replace(/\s+/g, " ").trim();
}

export function getFitUnavailableReason(job: JobItem): FitUnavailableReason | null {
  if (!job.title?.trim()) return "empty_title";
  if (jobDescriptionCorpus(job).length < MIN_DESCRIPTION_CHARS) return "empty_description";
  return null;
}

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

/** Stricter gate for Tier-2 description mining — dictionary + allowlist only, no generic JD tokens. */
export function isDescriptionFallbackKeyword(keyword: string): boolean {
  const raw = keyword.toLowerCase().trim().replace(/\s+/g, " ");
  if (raw.length < 2) return false;
  if (SPARSE_FALLBACK_COMPOUNDS.has(raw)) return true;
  if (!raw.includes(" ")) {
    if (SPARSE_FALLBACK_TOKENS.has(raw)) return true;
    return getCanonicalsFromTextLine(raw).length > 0;
  }
  if (getCanonicalsFromTextLine(raw).length > 0) return true;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && isAcceptableResumeBigram(parts[0]!, parts[1]!)) {
    return SPARSE_FALLBACK_COMPOUNDS.has(raw) || parts.every((p) => SPARSE_FALLBACK_TOKENS.has(p));
  }
  return false;
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

function canonicalForDescriptionSignal(raw: string): string | null {
  if (!isDescriptionFallbackKeyword(raw)) return null;
  const dict = getCanonicalsFromTextLine(raw);
  if (dict.length > 0) return dict[0]!.canonical;
  const key = normalizeKeywordForMatch(raw);
  return isDescriptionFallbackKeyword(key) ? key : null;
}

function collectSignalsFromLines(
  lines: string[],
  source: JobSkillSource,
  weight: number,
  options?: { strictDescription?: boolean },
): JobSkill[] {
  const byKey = new Map<string, JobSkill>();
  const strict = options?.strictDescription === true;

  const add = (raw: string) => {
    if (strict) {
      const canonical = canonicalForDescriptionSignal(raw);
      if (!canonical || byKey.has(canonical)) return;
      byKey.set(canonical, { canonical, source, weight });
      return;
    }
    const key = normalizeKeywordForMatch(raw);
    if (!isSparseFallbackKeyword(key)) return;
    if (!byKey.has(key)) {
      byKey.set(key, { canonical: key, source, weight });
    }
  };

  for (const line of lines) {
    for (const { canonical } of getCanonicalsFromRequirementLine(line)) {
      add(canonical);
    }
    if (strict) {
      for (const phrase of bigramsFromLine(line)) {
        add(phrase);
      }
      for (const token of tokenizeLine(line)) {
        if (SPARSE_FALLBACK_TOKENS.has(normalizeKeywordForMatch(token))) {
          add(token);
        }
      }
    } else {
      for (const token of tokenizeLine(line)) {
        add(token);
      }
      for (const phrase of bigramsFromLine(line)) {
        add(phrase);
      }
    }
  }

  return [...byKey.values()];
}

function collectSparseFallbackSkills(job: JobItem): JobSkill[] {
  const parts: string[] = [];
  for (const line of job.parsedDescription?.requirement ?? []) parts.push(line);
  for (const line of job.parsedDescription?.responsibility ?? []) parts.push(line);

  const byKey = new Map<string, JobSkill>();
  for (const s of collectSignalsFromLines(parts, "sparse_requirement", W_SPARSE_REQ)) {
    byKey.set(s.canonical, s);
  }
  for (const s of collectSignalsFromLines(
    job.parsedDescription?.responsibility ?? [],
    "sparse_responsibility",
    W_SPARSE_RESP,
  )) {
    if (!byKey.has(s.canonical)) byKey.set(s.canonical, s);
  }

  for (const raw of job.skills ?? []) {
    for (const { canonical } of getCanonicalsFromTextLine(raw)) {
      const key = normalizeKeywordForMatch(canonical);
      if (isSparseFallbackKeyword(key) && !byKey.has(key)) {
        byKey.set(key, { canonical: key, source: "sparse_requirement", weight: W_SPARSE_REQ });
      }
    }
  }

  return [...byKey.values()];
}

function collectDescriptionFallbackSkills(job: JobItem): JobSkill[] {
  const chunks: string[] = [];
  const desc = normalizedJobDescription(job.description);
  if (desc.length >= MIN_DESCRIPTION_CHARS) chunks.push(desc);
  if (job.previewLines?.length) {
    chunks.push(...job.previewLines.map((line) => stripHtml(line)).filter(Boolean));
  }
  const text = chunks.join("\n").trim();
  if (text.length < MIN_DESCRIPTION_CHARS) return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) lines.push(text);
  return collectSignalsFromLines(lines, "description_fallback", W_DESCRIPTION, {
    strictDescription: true,
  });
}

function collectTitleFamilySkills(job: JobItem): JobSkill[] {
  const haystack = `${job.title} ${job.role ?? ""}`;
  const out: JobSkill[] = [];
  const seen = new Set<string>();

  for (const pack of ROLE_HINT_PACKS) {
    if (!pack.pattern.test(haystack)) continue;
    for (const skill of pack.skills) {
      const key = normalizeKeywordForMatch(skill);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ canonical: key, source: "title_family", weight: W_TITLE_FAMILY });
    }
  }

  return out;
}

/** @deprecated Use collectTitleFamilySkills — kept for tests referencing role hints. */
function collectRoleHintSkills(job: JobItem): JobSkill[] {
  return collectTitleFamilySkills(job);
}

function countSourceBreakdown(skills: JobSkill[]): FitSignalMetadata["sourceBreakdown"] {
  const breakdown = {
    taxonomy: 0,
    enriched: 0,
    parsed: 0,
    description: 0,
    titleFamily: 0,
  };
  for (const s of skills) {
    if (s.source === "taxonomy") breakdown.taxonomy++;
    else if (s.source === "enriched") breakdown.enriched++;
    else if (
      s.source === "parsed_requirement" ||
      s.source === "sparse_requirement" ||
      s.source === "sparse_responsibility"
    ) {
      breakdown.parsed++;
    } else if (s.source === "description_fallback") breakdown.description++;
    else if (s.source === "title_family" || s.source === "role_hint") breakdown.titleFamily++;
  }
  return breakdown;
}

function tier1Skills(job: JobItem): JobSkill[] {
  const merged = new Map<string, JobSkill>();
  mergeSkills(merged, extractJobSkills(job));
  mergeSkills(merged, collectSparseFallbackSkills(job));
  return sortAndCap([...merged.values()]);
}

export function resolveJobMatchSkillsWithMeta(job: JobItem): JobMatchResolution {
  const hardFail = getFitUnavailableReason(job);
  if (hardFail) {
    return {
      skills: [],
      fitTier: null,
      confidence: null,
      signalCount: 0,
      sourceBreakdown: {
        taxonomy: 0,
        enriched: 0,
        parsed: 0,
        description: 0,
        titleFamily: 0,
      },
      unavailableReason: hardFail,
    };
  }

  const tier1 = tier1Skills(job);
  if (tier1.length >= MIN_JOB_MATCH_SIGNALS) {
    return {
      skills: tier1,
      fitTier: 1,
      confidence: confidenceForFitTier(1),
      signalCount: tier1.length,
      sourceBreakdown: countSourceBreakdown(tier1),
      unavailableReason: null,
    };
  }

  const merged2 = new Map<string, JobSkill>();
  for (const s of tier1) merged2.set(s.canonical, s);
  mergeSkills(merged2, collectDescriptionFallbackSkills(job));
  const tier2 = sortAndCap([...merged2.values()]);
  if (tier2.length >= MIN_JOB_MATCH_SIGNALS) {
    return {
      skills: tier2,
      fitTier: 2,
      confidence: confidenceForFitTier(2),
      signalCount: tier2.length,
      sourceBreakdown: countSourceBreakdown(tier2),
      unavailableReason: null,
    };
  }

  const merged3 = new Map<string, JobSkill>();
  for (const s of tier2) merged3.set(s.canonical, s);
  mergeSkills(merged3, collectTitleFamilySkills(job));
  const tier3 = sortAndCap([...merged3.values()]);
  if (tier3.length >= MIN_JOB_MATCH_SIGNALS) {
    return {
      skills: tier3,
      fitTier: 3,
      confidence: confidenceForFitTier(3),
      signalCount: tier3.length,
      sourceBreakdown: countSourceBreakdown(tier3),
      unavailableReason: null,
    };
  }

  if (tier3.length > 0) {
    return {
      skills: tier3,
      fitTier: 3,
      confidence: confidenceForFitTier(3),
      signalCount: tier3.length,
      sourceBreakdown: countSourceBreakdown(tier3),
      unavailableReason: null,
    };
  }

  return {
    skills: [],
    fitTier: null,
    confidence: null,
    signalCount: 0,
    sourceBreakdown: countSourceBreakdown([]),
    unavailableReason: "insufficient_signals",
  };
}

/**
 * Resolve scorable job signals: tier 1 structured, tier 2 description, tier 3 title family.
 */
export function resolveJobMatchSkills(job: JobItem): JobSkill[] {
  return resolveJobMatchSkillsWithMeta(job).skills;
}

/** Canonicals / keywords for semantic match API (stable order). */
export function jobMatchSignalsForSemantic(job: JobItem): string[] {
  return jobSkillCanonicalsForSemantic(resolveJobMatchSkills(job));
}

export function jobHasResolvableMatchSignals(job: JobItem): boolean {
  const resolution = resolveJobMatchSkillsWithMeta(job);
  return resolution.skills.length > 0 && resolution.unavailableReason === null;
}

export { collectRoleHintSkills };
