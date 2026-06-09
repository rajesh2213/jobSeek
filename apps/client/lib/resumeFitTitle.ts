import type { JobItem } from "./api";
import type { ResumeExperienceEntry } from "./resumeFitExperience";

export type RoleFamily =
  | "engineering.backend"
  | "engineering.frontend"
  | "software.engineering"
  | "technical.operations"
  | "mechanical.engineering"
  | "engineering.devops"
  | "engineering.data"
  | "engineering.ml"
  | "product"
  | "design"
  | "sales"
  | "customer_success"
  | "marketing"
  | "recruiting"
  | "hr"
  | "finance"
  | "operations"
  | "healthcare.clinical"
  | "healthcare.admin"
  | "legal"
  | "research"
  | "other";

export type TitleFitRelation = "same" | "adjacent" | "related" | "different";

export interface ApplyProfileTitleLite {
  titles?: string[];
  highlights?: string[];
}

export interface CandidateTitleInput {
  currentTitle?: string | null;
  resumeStructuredV1?: { experience?: ResumeExperienceEntry[] } | null;
  applyProfileSummary?: ApplyProfileTitleLite | null;
  resumeText?: string | null;
}

export interface TitleFitResult {
  candidateFamily: RoleFamily | null;
  jobFamily: RoleFamily | null;
  candidateTitle: string | null;
  jobTitle: string | null;
  titleFitScore: number | null;
  relation: TitleFitRelation | null;
  candidateSource: "current_title" | "structured_resume" | "profile_summary" | "resume_text" | null;
  jobSource: "title" | "role_slug" | "category" | null;
}

/** High-specificity patterns first; generic `engineer` no longer defaults to software. */
const TITLE_FAMILY_PATTERNS: Array<{ re: RegExp; family: RoleFamily }> = [
  { re: /\bmechanical\s+engineer\b/i, family: "mechanical.engineering" },
  { re: /\bmanufacturing\s+engineer\b/i, family: "mechanical.engineering" },
  { re: /\baerospace\s+engineer\b/i, family: "mechanical.engineering" },
  { re: /\bcnc\s+engineer\b/i, family: "mechanical.engineering" },
  { re: /\bproduction\s+engineer\b/i, family: "mechanical.engineering" },
  { re: /\bspacecraft\s+technician\b/i, family: "technical.operations" },
  { re: /\bsimulator\s+technician\b/i, family: "technical.operations" },
  { re: /\boptical\s+technician\b/i, family: "technical.operations" },
  { re: /\bnetwork\s+technician\b/i, family: "technical.operations" },
  { re: /\bfield\s+engineer\b/i, family: "technical.operations" },
  { re: /\bservice\s+engineer\b/i, family: "technical.operations" },
  { re: /\bassembler\b/i, family: "technical.operations" },
  { re: /\btechnician\b/i, family: "technical.operations" },
  { re: /\bbackend\b/i, family: "engineering.backend" },
  { re: /\bfront[\s-]?end\b/i, family: "engineering.frontend" },
  { re: /\bfull[\s-]?stack\b/i, family: "software.engineering" },
  { re: /\bdevops\b|\bsre\b|\bsite\s+reliability\b|\bplatform\s+engineer\b/i, family: "engineering.devops" },
  { re: /\bmachine\s+learning\b|\bml\s+engineer\b|\bai\s+engineer\b/i, family: "engineering.ml" },
  { re: /\bdata\s+(scientist|engineer|analyst)\b/i, family: "engineering.data" },
  { re: /\bproduct\s+manager\b|\bproduct\s+owner\b|\bproduct\s+lead\b/i, family: "product" },
  { re: /\bux\b|\bui\b|\buser\s+experience\b|\bproduct\s+designer\b|\bgraphic\s+designer\b/i, family: "design" },
  { re: /\bcustomer\s+success\b|\bclient\s+success\b/i, family: "customer_success" },
  { re: /\bsales\s+engineer\b/i, family: "sales" },
  { re: /\baccount\s+executive\b|\bsales\s+(rep|representative|executive|manager)\b/i, family: "sales" },
  { re: /\brecruiter\b|\brecruiting\b|\btalent\s+acquisition\b|\bsourcer\b/i, family: "recruiting" },
  { re: /\bhuman\s+resources\b|\bhr\s+(generalist|manager|business\s+partner)\b/i, family: "hr" },
  { re: /\bphysical\s+therapist\b|\bnurse\b|\bphysician\b|\bclinical\b|\btherapist\b|\bdentist\b/i, family: "healthcare.clinical" },
  { re: /\bmedical\s+administrator\b|\bhealthcare\s+admin\b|\bpatient\s+coordinator\b/i, family: "healthcare.admin" },
  { re: /\bmarketing\b|\bseo\b|\bcontent\s+strategist\b|\bbrand\s+manager\b/i, family: "marketing" },
  { re: /\bfinancial\s+analyst\b|\baccountant\b|\bcontroller\b|\bfinance\b|\baccounting\b/i, family: "finance" },
  { re: /\boperations\b|\bsupply\s+chain\b|\blogistics\b|\bprocurement\b/i, family: "operations" },
  { re: /\battorney\b|\blawyer\b|\blegal\b|\bparalegal\b/i, family: "legal" },
  { re: /\bresearch\s+scientist\b|\bresearcher\b|\blab\s+technician\b/i, family: "research" },
  { re: /\bsoftware\s+engineer\b/i, family: "software.engineering" },
  { re: /\bdeveloper\b|\bprogrammer\b/i, family: "software.engineering" },
];

const ROLE_SLUG_PATTERNS: Array<{ re: RegExp; family: RoleFamily }> = [
  { re: /mechanical-engineer|manufacturing-engineer|aerospace|cnc|production-engineer/i, family: "mechanical.engineering" },
  { re: /technician|field-engineer|service-engineer|assembler/i, family: "technical.operations" },
  { re: /backend/i, family: "engineering.backend" },
  { re: /frontend|front-end/i, family: "engineering.frontend" },
  { re: /fullstack|full-stack/i, family: "software.engineering" },
  { re: /devops|sre|platform/i, family: "engineering.devops" },
  { re: /machine-learning|\bml\b|ai-engineer/i, family: "engineering.ml" },
  { re: /data-scientist|data-engineer|data-analyst/i, family: "engineering.data" },
  { re: /software-engineer|software-developer/i, family: "software.engineering" },
  { re: /product-manager|product-owner/i, family: "product" },
  { re: /designer|design|ux|ui/i, family: "design" },
  { re: /customer-success/i, family: "customer_success" },
  { re: /sales/i, family: "sales" },
  { re: /recruiter|recruiting|talent/i, family: "recruiting" },
  { re: /human-resources|\bhr\b/i, family: "hr" },
  { re: /marketing/i, family: "marketing" },
  { re: /finance|accounting/i, family: "finance" },
  { re: /operations|supply-chain|logistics/i, family: "operations" },
  { re: /healthcare|clinical|nurse|therapist/i, family: "healthcare.clinical" },
  { re: /legal|attorney/i, family: "legal" },
  { re: /research/i, family: "research" },
];

const CATEGORY_FAMILY: Record<string, RoleFamily> = {
  data: "engineering.data",
  product: "product",
  design: "design",
  sales: "sales",
  "customer-support": "customer_success",
  marketing: "marketing",
  healthcare: "healthcare.clinical",
  hr: "recruiting",
  finance: "finance",
  operations: "operations",
  legal: "legal",
};

const EXPLICIT_TITLE_FIT_SCORES = new Map<string, number>([
  [pairKey("software.engineering", "technical.operations"), 40],
  [pairKey("software.engineering", "mechanical.engineering"), 25],
  [pairKey("technical.operations", "mechanical.engineering"), 60],
]);

const ADJACENT_PAIRS = new Set([
  pairKey("engineering.backend", "software.engineering"),
  pairKey("engineering.frontend", "software.engineering"),
  pairKey("engineering.data", "engineering.ml"),
  pairKey("sales", "customer_success"),
  pairKey("recruiting", "hr"),
]);

const RELATED_PAIRS = new Set([
  pairKey("engineering.backend", "engineering.devops"),
  pairKey("product", "design"),
  pairKey("operations", "finance"),
]);

function pairKey(a: RoleFamily, b: RoleFamily): string {
  return [a, b].sort().join("|");
}

function parseEndMs(endDate?: string): number {
  if (!endDate || /present|current|now/i.test(endDate)) return Date.now();
  const y = Number(endDate.slice(0, 4));
  const m = endDate.length >= 7 ? Number(endDate.slice(5, 7)) : 12;
  if (!Number.isFinite(y)) return Date.now();
  return Date.UTC(y, Math.max(0, m - 1), 1);
}

function familyFromText(text: string): RoleFamily | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const { re, family } of TITLE_FAMILY_PATTERNS) {
    if (re.test(trimmed)) return family;
  }
  return null;
}

function latestExperienceRole(
  experience: ResumeExperienceEntry[] | undefined | null,
): { role: string | null; endMs: number } | null {
  if (!experience?.length) return null;
  let best: { role: string | null; endMs: number } | null = null;
  for (const entry of experience) {
    const endMs = parseEndMs(entry.endDate);
    const role = entry.role?.trim() || null;
    if (!best || endMs >= best.endMs) best = { role, endMs };
  }
  return best;
}

function titlesFromResumeText(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const titleHint =
    /\b(engineer|developer|manager|director|scientist|analyst|architect|designer|consultant|lead|specialist|coordinator|executive|researcher|programmer|recruiter|therapist|nurse|sales|marketing|product|technician)\b/i;
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 5 && l.length <= 90 && titleHint.test(l))
    .slice(0, 3);
}

export function deriveCandidateRoleFamily(input: CandidateTitleInput): {
  family: RoleFamily | null;
  title: string | null;
  source: TitleFitResult["candidateSource"];
} {
  const currentTitle = input.currentTitle?.trim();
  if (currentTitle) {
    const family = familyFromText(currentTitle);
    if (family) return { family, title: currentTitle, source: "current_title" };
  }

  const latest = latestExperienceRole(input.resumeStructuredV1?.experience);
  if (latest?.role) {
    const family = familyFromText(latest.role);
    if (family) return { family, title: latest.role, source: "structured_resume" };
  }

  const profileTitle = input.applyProfileSummary?.titles?.[0]?.trim();
  if (profileTitle) {
    const family = familyFromText(profileTitle);
    if (family) return { family, title: profileTitle, source: "profile_summary" };
  }

  for (const line of titlesFromResumeText(input.resumeText)) {
    const family = familyFromText(line);
    if (family) return { family, title: line, source: "resume_text" };
  }

  const highlight = input.applyProfileSummary?.highlights?.[0]?.trim();
  if (highlight) {
    const family = familyFromText(highlight);
    if (family) return { family, title: highlight, source: "profile_summary" };
  }

  return {
    family: null,
    title: currentTitle ?? latest?.role ?? profileTitle ?? null,
    source: null,
  };
}

export function deriveJobRoleFamily(job: JobItem): {
  family: RoleFamily | null;
  title: string | null;
  source: TitleFitResult["jobSource"];
} {
  const jobTitle = job.title?.trim() ?? "";
  if (jobTitle) {
    const family = familyFromText(jobTitle);
    if (family) return { family, title: jobTitle, source: "title" };
  }

  const roleSlug = job.role?.trim() ?? "";
  if (roleSlug) {
    for (const { re, family } of ROLE_SLUG_PATTERNS) {
      if (re.test(roleSlug)) {
        return { family, title: jobTitle || roleSlug, source: "role_slug" };
      }
    }
  }

  const category = job.category?.trim().toLowerCase();
  if (category && CATEGORY_FAMILY[category]) {
    return {
      family: CATEGORY_FAMILY[category]!,
      title: jobTitle || category,
      source: "category",
    };
  }

  if (category) {
    return {
      family: "other",
      title: jobTitle || category,
      source: "category",
    };
  }

  return { family: null, title: jobTitle || null, source: null };
}

export function titleFitRelation(
  candidateFamily: RoleFamily | null,
  jobFamily: RoleFamily | null,
): TitleFitRelation | null {
  if (!candidateFamily || !jobFamily) return null;
  if (candidateFamily === jobFamily) return "same";

  const explicit = EXPLICIT_TITLE_FIT_SCORES.get(pairKey(candidateFamily, jobFamily));
  if (explicit != null) {
    if (explicit >= 60) return "related";
    if (explicit >= 40) return "related";
    return "different";
  }

  const key = pairKey(candidateFamily, jobFamily);
  if (ADJACENT_PAIRS.has(key)) return "adjacent";
  if (RELATED_PAIRS.has(key)) return "related";
  return "different";
}

export function computeTitleFitScore(
  candidateFamily: RoleFamily | null,
  jobFamily: RoleFamily | null,
): number | null {
  if (!candidateFamily || !jobFamily) return null;
  if (candidateFamily === jobFamily) return 100;

  const explicit = EXPLICIT_TITLE_FIT_SCORES.get(pairKey(candidateFamily, jobFamily));
  if (explicit != null) return explicit;

  const relation = titleFitRelation(candidateFamily, jobFamily);
  if (!relation) return null;
  switch (relation) {
    case "same":
      return 100;
    case "adjacent":
      return 80;
    case "related":
      return 60;
    default:
      return 25;
  }
}

export function isTitleFamilyMismatch(
  candidateFamily: RoleFamily | null,
  jobFamily: RoleFamily | null,
): boolean {
  const relation = titleFitRelation(candidateFamily, jobFamily);
  return relation === "different";
}

/** Max final score when title families are unrelated or weakly cross-matched. */
export function deriveTitleMismatchCap(titleFit: TitleFitResult): number | null {
  if (titleFit.relation === "different") return 45;
  if (titleFit.titleFitScore != null && titleFit.titleFitScore <= 40) return 45;
  return null;
}

export function applyTitleMismatchCap(
  score: number | null,
  titleFit: TitleFitResult,
): { score: number | null; cap: number | null; capApplied: boolean } {
  if (score == null) return { score: null, cap: null, capApplied: false };
  const cap = deriveTitleMismatchCap(titleFit);
  if (cap == null) return { score, cap: null, capApplied: false };
  const capped = Math.min(score, cap);
  return { score: capped, cap, capApplied: capped < score };
}

export function computeTitleFit(job: JobItem, candidate: CandidateTitleInput): TitleFitResult {
  const cand = deriveCandidateRoleFamily(candidate);
  const jobFam = deriveJobRoleFamily(job);
  const relation = titleFitRelation(cand.family, jobFam.family);
  return {
    candidateFamily: cand.family,
    jobFamily: jobFam.family,
    candidateTitle: cand.title,
    jobTitle: jobFam.title,
    titleFitScore: computeTitleFitScore(cand.family, jobFam.family),
    relation,
    candidateSource: cand.source,
    jobSource: jobFam.source,
  };
}
