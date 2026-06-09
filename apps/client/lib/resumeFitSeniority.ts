import type { JobItem } from "./api";
import {
  deriveCandidateExperienceYears,
  deriveJobRequiredYears,
  type CandidateExperienceInput,
  type ResumeExperienceEntry,
} from "./resumeFitExperience";

export const SENIORITY_LEVELS = {
  intern: 0,
  junior: 1,
  associate: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  staff: 5,
  principal: 6,
  manager: 5,
  director: 7,
  vp: 8,
  executive: 9,
} as const;

export type SeniorityLevelKey = keyof typeof SENIORITY_LEVELS;

const LEVEL_LABELS: Record<number, string> = {
  0: "Intern",
  1: "Junior",
  2: "Mid",
  3: "Senior",
  4: "Lead",
  5: "Staff",
  6: "Principal",
  7: "Director",
  8: "VP",
  9: "Executive",
};

const TITLE_PATTERNS: Array<{ re: RegExp; level: number }> = [
  { re: /\bexecutive\b|\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|\bchief\b/i, level: 9 },
  { re: /\bvp\b|\bvice\s+president\b/i, level: 8 },
  { re: /\bdirector\b/i, level: 7 },
  { re: /\bprincipal\b/i, level: 6 },
  { re: /\bstaff\b/i, level: 5 },
  { re: /\bmanager\b/i, level: 5 },
  { re: /\blead\b/i, level: 4 },
  { re: /\bsenior\b|\bsr\.?\b/i, level: 3 },
  { re: /\biv\b/i, level: 4 },
  { re: /\biii\b/i, level: 3 },
  { re: /\bii\b/i, level: 2 },
  { re: /\bmid(?:dle)?\b/i, level: 2 },
  { re: /\bassociate\b/i, level: 1 },
  { re: /\bjunior\b|\bjr\.?\b|\bentry[\s-]level\b/i, level: 1 },
  { re: /\bintern\b|\bgraduate\b/i, level: 0 },
  { re: /\bengineer\b|\bdeveloper\b|\bprogrammer\b/i, level: 2 },
  { re: /\banalyst\b|\bspecialist\b|\bconsultant\b|\bscientist\b/i, level: 2 },
];

const EXPERIENCE_LEVEL_MAP: Record<string, number> = {
  junior: 1,
  mid: 2,
  senior: 3,
};

export interface SeniorityFitResult {
  candidateLevel: number | null;
  jobLevel: number | null;
  candidateTitle: string | null;
  jobTitle: string | null;
  seniorityFitScore: number | null;
  candidateSource: "current_title" | "structured_resume" | "years_heuristic" | null;
  jobSource: "title" | "experience_level" | "years_heuristic" | null;
}

function parseEndMs(endDate?: string): number {
  if (!endDate || /present|current|now/i.test(endDate)) return Date.now();
  const y = Number(endDate.slice(0, 4));
  const m = endDate.length >= 7 ? Number(endDate.slice(5, 7)) : 12;
  if (!Number.isFinite(y)) return Date.now();
  return Date.UTC(y, Math.max(0, m - 1), 1);
}

function seniorityFromTitle(title: string): number | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  for (const { re, level } of TITLE_PATTERNS) {
    if (re.test(trimmed)) return level;
  }
  return null;
}

function candidateYearsHeuristicLevel(years: number): number {
  if (years < 1) return SENIORITY_LEVELS.junior;
  if (years < 3) return SENIORITY_LEVELS.mid;
  if (years < 6) return SENIORITY_LEVELS.senior;
  if (years < 9) return SENIORITY_LEVELS.lead;
  if (years < 12) return SENIORITY_LEVELS.staff;
  return SENIORITY_LEVELS.principal;
}

function jobYearsHeuristicLevel(years: number): number {
  if (years <= 1) return SENIORITY_LEVELS.junior;
  if (years <= 3) return SENIORITY_LEVELS.mid;
  if (years <= 6) return SENIORITY_LEVELS.senior;
  if (years <= 9) return SENIORITY_LEVELS.lead;
  if (years <= 12) return SENIORITY_LEVELS.staff;
  return SENIORITY_LEVELS.principal;
}

function latestExperienceRole(
  experience: ResumeExperienceEntry[] | undefined | null,
): { role: string | null; endMs: number } | null {
  if (!experience?.length) return null;
  let best: { role: string | null; endMs: number } | null = null;
  for (const entry of experience) {
    const endMs = parseEndMs(entry.endDate);
    const role = entry.role?.trim() || null;
    if (!best || endMs >= best.endMs) {
      best = { role, endMs };
    }
  }
  return best;
}

export function seniorityLabel(level: number | null): string | null {
  if (level == null) return null;
  return LEVEL_LABELS[level] ?? null;
}

export function deriveCandidateSeniority(input: CandidateExperienceInput): {
  level: number | null;
  title: string | null;
  source: SeniorityFitResult["candidateSource"];
} {
  const currentTitle = input.currentTitle?.trim();
  if (currentTitle) {
    const level = seniorityFromTitle(currentTitle);
    if (level != null) {
      return { level, title: currentTitle, source: "current_title" };
    }
  }

  const latest = latestExperienceRole(input.resumeStructuredV1?.experience);
  if (latest?.role) {
    const level = seniorityFromTitle(latest.role);
    if (level != null) {
      return { level, title: latest.role, source: "structured_resume" };
    }
  }

  const years = deriveCandidateExperienceYears(input).years;
  if (years != null) {
    const level = candidateYearsHeuristicLevel(years);
    return {
      level,
      title: currentTitle ?? latest?.role ?? seniorityLabel(level),
      source: "years_heuristic",
    };
  }

  return { level: null, title: currentTitle ?? latest?.role ?? null, source: null };
}

export function deriveJobSeniority(job: JobItem): {
  level: number | null;
  title: string | null;
  source: SeniorityFitResult["jobSource"];
} {
  const jobTitle = job.title?.trim() ?? "";
  if (jobTitle) {
    const level = seniorityFromTitle(jobTitle);
    if (level != null) {
      return { level, title: jobTitle, source: "title" };
    }
  }

  const expLevel = job.experienceLevel?.toLowerCase().trim();
  if (expLevel && EXPERIENCE_LEVEL_MAP[expLevel] != null) {
    return {
      level: EXPERIENCE_LEVEL_MAP[expLevel]!,
      title: jobTitle || seniorityLabel(EXPERIENCE_LEVEL_MAP[expLevel]!),
      source: "experience_level",
    };
  }

  const years = deriveJobRequiredYears(job).years;
  if (years != null) {
    const level = jobYearsHeuristicLevel(years);
    return {
      level,
      title: jobTitle || seniorityLabel(level),
      source: "years_heuristic",
    };
  }

  return { level: null, title: jobTitle || null, source: null };
}

export function computeSeniorityFitScore(
  candidateLevel: number | null,
  jobLevel: number | null,
): number | null {
  if (candidateLevel == null || jobLevel == null) return null;

  const gap = Math.abs(candidateLevel - jobLevel);
  if (gap === 0) return 100;

  const candidateAbove = candidateLevel > jobLevel;
  const effectiveGap = candidateAbove ? gap * 0.5 : gap;

  if (candidateAbove) {
    if (effectiveGap < 1.5) return 100;
    return Math.max(25, Math.round(80 - (effectiveGap - 1.5) * 20));
  }

  if (effectiveGap <= 1) return 80;
  if (effectiveGap <= 2) return 60;
  if (effectiveGap <= 3) return 40;
  return 25;
}

export function computeSeniorityFit(
  job: JobItem,
  candidate: CandidateExperienceInput,
): SeniorityFitResult {
  const cand = deriveCandidateSeniority(candidate);
  const jobSen = deriveJobSeniority(job);
  return {
    candidateLevel: cand.level,
    jobLevel: jobSen.level,
    candidateTitle: cand.title,
    jobTitle: jobSen.title,
    seniorityFitScore: computeSeniorityFitScore(cand.level, jobSen.level),
    candidateSource: cand.source,
    jobSource: jobSen.source,
  };
}

export function blendResumeFitScore(
  skillsFitScore: number | null,
  experienceFitScore: number | null,
  seniorityFitScore: number | null,
  titleFitScore: number | null = null,
): number | null {
  if (skillsFitScore == null) return null;

  const parts: Array<{ score: number; weight: number }> = [
    { score: skillsFitScore, weight: 0.5 },
  ];
  if (experienceFitScore != null) parts.push({ score: experienceFitScore, weight: 0.2 });
  if (seniorityFitScore != null) parts.push({ score: seniorityFitScore, weight: 0.15 });
  if (titleFitScore != null) parts.push({ score: titleFitScore, weight: 0.15 });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.score * p.weight, 0);
  return Math.round(weighted / totalWeight);
}

/** Max final score when candidate seniority is below role; `null` means no cap. */
export function deriveSeniorityGapCap(
  candidateLevel: number | null,
  jobLevel: number | null,
): number | null {
  if (candidateLevel == null || jobLevel == null) return null;
  if (candidateLevel >= jobLevel) return null;

  const gap = jobLevel - candidateLevel;
  if (gap >= 4) return 40;
  if (gap >= 3) return 55;
  if (gap >= 2) return 70;
  return null;
}

export function applySeniorityGapCap(
  score: number | null,
  candidateLevel: number | null,
  jobLevel: number | null,
): { score: number | null; cap: number | null; capApplied: boolean } {
  if (score == null) {
    return { score: null, cap: null, capApplied: false };
  }

  const cap = deriveSeniorityGapCap(candidateLevel, jobLevel);
  if (cap == null) {
    return { score, cap: null, capApplied: false };
  }

  const capped = Math.min(score, cap);
  return { score: capped, cap, capApplied: capped < score };
}
