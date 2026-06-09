import type { JobItem } from "./api";

const MAX_CANDIDATE_YEARS = 50;

export interface ApplyProfileSummaryLite {
  yearsExp?: number | null;
}

export interface ResumeExperienceEntry {
  role?: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  durationYears?: number;
  bullets?: string[];
}

export interface ResumeStructuredV1Lite {
  experience?: ResumeExperienceEntry[];
}

export interface CandidateExperienceInput {
  yearsOfExperience?: number | null;
  currentTitle?: string | null;
  resumeStructuredV1?: ResumeStructuredV1Lite | null;
  applyProfileSummary?: ApplyProfileSummaryLite | null;
}

export interface ExperienceFitResult {
  candidateYears: number | null;
  requiredYears: number | null;
  experienceFitScore: number | null;
  candidateSource: "user_years" | "structured_resume" | "profile_summary" | null;
  requiredSource: "explicit" | "title_heuristic" | "experience_level" | null;
}

type DateInterval = { startMs: number; endMs: number };

const EXPLICIT_YEARS_PATTERNS: Array<{ re: RegExp; pick: (m: RegExpMatchArray) => number }> = [
  {
    re: /\b(\d{1,2})\s*-\s*(\d{1,2})\s*\+?\s*years?\b/i,
    pick: (m) => Math.round((Number(m[1]) + Number(m[2])) / 2),
  },
  {
    re: /\b(\d{1,2})\s*\+\s*years?\b/i,
    pick: (m) => Number(m[1]),
  },
  {
    re: /\b(\d{1,2})\+?\s*years?\b/i,
    pick: (m) => Number(m[1]),
  },
  {
    re: /\b(\d{1,2})\s*\+\s*yrs?\b/i,
    pick: (m) => Number(m[1]),
  },
  {
    re: /\b(\d{1,2})\+?\s*yrs?\b/i,
    pick: (m) => Number(m[1]),
  },
];

const TITLE_HEURISTICS: Array<{ re: RegExp; years: number }> = [
  { re: /\bvp\b|\bvice\s+president\b/i, years: 12 },
  { re: /\bdirector\b/i, years: 10 },
  { re: /\bprincipal\b/i, years: 10 },
  { re: /\barchitect\b/i, years: 10 },
  { re: /\bstaff\b/i, years: 8 },
  { re: /\blead\b/i, years: 7 },
  { re: /\bmanager\b/i, years: 7 },
  { re: /\bsenior\b|\bsr\.?\b/i, years: 5 },
  { re: /\bassociate\b/i, years: 2 },
  { re: /\bjunior\b|\bjr\.?\b/i, years: 1 },
  { re: /\bintern\b/i, years: 0 },
  { re: /\bengineer\b|\bdeveloper\b/i, years: 3 },
];

const EXPERIENCE_LEVEL_YEARS: Record<string, number> = {
  junior: 1,
  mid: 3,
  senior: 5,
};

function clampYears(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_CANDIDATE_YEARS, Math.round(n * 10) / 10);
}

function parseEndMs(endDate?: string): number {
  if (!endDate || /present|current|now/i.test(endDate)) return Date.now();
  const y = Number(endDate.slice(0, 4));
  const m = endDate.length >= 7 ? Number(endDate.slice(5, 7)) : 12;
  if (!Number.isFinite(y)) return Date.now();
  return Date.UTC(y, Math.max(0, m - 1), 1);
}

function parseStartMs(startDate?: string): number | null {
  if (!startDate) return null;
  const y = Number(startDate.slice(0, 4));
  const m = startDate.length >= 7 ? Number(startDate.slice(5, 7)) : 1;
  if (!Number.isFinite(y)) return null;
  return Date.UTC(y, Math.max(0, m - 1), 1);
}

function mergeIntervals(intervals: DateInterval[]): DateInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: DateInterval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = out[out.length - 1]!;
    if (cur.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
    } else {
      out.push(cur);
    }
  }
  return out;
}

function yearsFromIntervals(intervals: DateInterval[]): number {
  const merged = mergeIntervals(intervals);
  let months = 0;
  for (const iv of merged) {
    const diff = iv.endMs - iv.startMs;
    if (diff <= 0) continue;
    months += diff / (1000 * 60 * 60 * 24 * 30.4375);
  }
  return clampYears(months / 12);
}

export function totalYearsFromStructuredExperience(
  experience: ResumeExperienceEntry[] | undefined | null,
): number | null {
  if (!experience?.length) return null;
  const intervals: DateInterval[] = [];

  for (const entry of experience) {
    if (typeof entry.durationYears === "number" && entry.durationYears > 0) {
      const startMs = Date.now() - entry.durationYears * 365.25 * 24 * 60 * 60 * 1000;
      intervals.push({ startMs, endMs: Date.now() });
      continue;
    }
    const startMs = parseStartMs(entry.startDate);
    if (startMs == null) continue;
    const endMs = parseEndMs(entry.endDate);
    if (endMs <= startMs) continue;
    intervals.push({ startMs, endMs });
  }

  if (!intervals.length) return null;
  return yearsFromIntervals(intervals);
}

export function deriveCandidateExperienceYears(
  input: CandidateExperienceInput,
): { years: number | null; source: ExperienceFitResult["candidateSource"] } {
  if (input.yearsOfExperience != null && input.yearsOfExperience > 0) {
    return { years: clampYears(input.yearsOfExperience), source: "user_years" };
  }

  const fromStructured = totalYearsFromStructuredExperience(input.resumeStructuredV1?.experience);
  if (fromStructured != null && fromStructured > 0) {
    return { years: fromStructured, source: "structured_resume" };
  }

  const summaryYears = input.applyProfileSummary?.yearsExp;
  if (summaryYears != null && summaryYears > 0) {
    return { years: clampYears(summaryYears), source: "profile_summary" };
  }

  return { years: null, source: null };
}

function extractExplicitYearsFromText(text: string): number | null {
  for (const { re, pick } of EXPLICIT_YEARS_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const years = pick(m);
      if (Number.isFinite(years) && years >= 0 && years <= MAX_CANDIDATE_YEARS) return years;
    }
  }
  return null;
}

function deriveTitleHeuristicYears(title: string): number | null {
  for (const { re, years } of TITLE_HEURISTICS) {
    if (re.test(title)) return years;
  }
  return null;
}

export function deriveJobRequiredYears(job: JobItem): {
  years: number | null;
  source: ExperienceFitResult["requiredSource"];
} {
  const corpus: string[] = [];
  for (const line of job.parsedDescription?.experience ?? []) corpus.push(line);
  for (const line of job.parsedDescription?.requirement ?? []) corpus.push(line);

  for (const line of corpus) {
    const years = extractExplicitYearsFromText(line);
    if (years != null) return { years, source: "explicit" };
  }

  const titleYears = deriveTitleHeuristicYears(job.title ?? "");
  if (titleYears != null) return { years: titleYears, source: "title_heuristic" };

  const description = job.description?.trim();
  if (description) {
    const descYears = extractExplicitYearsFromText(description);
    if (descYears != null) return { years: descYears, source: "explicit" };
  }

  const level = job.experienceLevel?.toLowerCase().trim();
  if (level && EXPERIENCE_LEVEL_YEARS[level] != null) {
    return { years: EXPERIENCE_LEVEL_YEARS[level]!, source: "experience_level" };
  }

  return { years: null, source: null };
}

export function computeExperienceFitScore(
  candidateYears: number | null,
  requiredYears: number | null,
): number | null {
  if (candidateYears == null || requiredYears == null) return null;
  const gap = candidateYears - requiredYears;
  if (gap >= 0) return 100;
  const penalty = Math.abs(gap) * 12;
  return Math.round(Math.max(40, 100 - penalty));
}

export function computeExperienceFit(
  job: JobItem,
  candidate: CandidateExperienceInput,
): ExperienceFitResult {
  const cand = deriveCandidateExperienceYears(candidate);
  const req = deriveJobRequiredYears(job);
  const experienceFitScore = computeExperienceFitScore(cand.years, req.years);
  return {
    candidateYears: cand.years,
    requiredYears: req.years,
    experienceFitScore,
    candidateSource: cand.source,
    requiredSource: req.source,
  };
}

export function blendSkillsAndExperienceScore(
  skillsFitScore: number | null,
  experienceFitScore: number | null,
): number | null {
  if (skillsFitScore == null) return null;
  if (experienceFitScore == null) return skillsFitScore;
  return Math.round(skillsFitScore * 0.8 + experienceFitScore * 0.2);
}

/** Max final score when candidate is under-required; `null` means no cap applies. */
export function deriveExperienceGapCap(
  candidateYears: number | null,
  requiredYears: number | null,
): number | null {
  if (candidateYears == null || requiredYears == null) return null;
  if (candidateYears >= requiredYears) return null;

  const gapYears = requiredYears - candidateYears;
  if (gapYears <= 2) return null;
  if (gapYears >= 8) return 35;
  if (gapYears >= 5) return 50;
  if (gapYears >= 3) return 65;
  return null;
}

export function applyExperienceGapCap(
  blendedScore: number | null,
  candidateYears: number | null,
  requiredYears: number | null,
): { score: number | null; cap: number | null; capApplied: boolean } {
  if (blendedScore == null) {
    return { score: null, cap: null, capApplied: false };
  }

  const cap = deriveExperienceGapCap(candidateYears, requiredYears);
  if (cap == null) {
    return { score: blendedScore, cap: null, capApplied: false };
  }

  const capped = Math.min(blendedScore, cap);
  return { score: capped, cap, capApplied: capped < blendedScore };
}
