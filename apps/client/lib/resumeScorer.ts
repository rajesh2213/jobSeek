import {
  ALIASES_BY_CANONICAL,
  DICTIONARY_VERSION,
} from "@jobseek/skill-constants";
import type { JobItem } from "./api";
import { generateSuggestionFromBullet, getTemplateSuggestion } from "./keywordSuggestions";
import {
  MAX_RESUME_MATCH_KEYWORDS,
  normalizeKeywordForMatch,
  resumeTextMatchesKeyword,
  takeTopScorableKeywords,
} from "./resumeKeywordFilter";
import {
  computeMatchBonus,
  computeSofterMissingMass,
  computeSofterScorePercent,
} from "./resumeScoreSoftening";
import { applyCredibilityCalibration } from "./resumeFitCalibration";
import type { FitConfidence, FitTier, FitUnavailableReason } from "./resumeFitConfidence";
import {
  applyExperienceGapCap,
  blendSkillsAndExperienceScore,
  computeExperienceFit,
  type CandidateExperienceInput,
} from "./resumeFitExperience";
import {
  jobHasResolvableMatchSignals,
  resolveJobMatchSkills,
  resolveJobMatchSkillsWithMeta,
} from "./jobMatchSignals";
import { jobSkillCanonicalsForSemantic, type JobSkill } from "./skillExtractor";

export {
  jobHasResolvableMatchSignals as jobHasMatchSignals,
  jobMatchSignalsForSemantic,
  resolveJobMatchSkills,
  resolveJobMatchSkillsWithMeta,
  getFitUnavailableReason,
  MIN_JOB_MATCH_SIGNALS,
} from "./jobMatchSignals";

const RESUME_FUZZY_ENABLED = false;
const LEGACY_ENV = "NEXT_PUBLIC_RESUME_LEGACY_KEYWORDS";

export function isResumeLegacyKeywordMode(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return process.env[LEGACY_ENV] === "true";
}

function isLegacyResumeScoring(): boolean {
  return isResumeLegacyKeywordMode();
}

const SCORE_DEBUG =
  (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development") ||
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_RESUME_SCORE_DEBUG === "true");

export interface KeywordResult {
  keyword: string;
  category: "required" | "preferred";
  priority: 1 | 2 | 3;
  weight?: number;
  // For matched:
  foundIn?: string; // excerpt from resume containing this keyword
  // For missing:
  suggestion?: string; // suggested bullet to add
  closestBullet?: string; // existing resume bullet it was derived from
  semanticSimilarity?: number; // 0-1, how confident the suggestion is
}

export type MatchAvailability = "scored" | "insufficient_job_signals" | "insufficient_evidence";

export type ResumeMatchGrade = "excellent" | "good" | "fair" | "poor"; // ≥75, ≥55, ≥35, <35

export interface ScoringResult {
  matchAvailability: MatchAvailability;
  /** Percent match when {@link MatchAvailability} is `scored`; otherwise `null`. */
  score: number | null;
  grade: ResumeMatchGrade | null;
  matched: KeywordResult[];
  missing: KeywordResult[];
  partial: KeywordResult[]; // semantic matches
  breakdown: {
    required: { matched: number; total: number };
    preferred: { matched: number; total: number };
  };
  topMissingKeywords: string[]; // up to 10, highest-priority missing
  confidenceLevel?: FitConfidence | null;
  signalCount?: number;
  fitTier?: FitTier | null;
  unavailableReason?: FitUnavailableReason | null;
  skillsFitScore?: number | null;
  experienceFitScore?: number | null;
  experienceYearsCandidate?: number | null;
  experienceYearsRequired?: number | null;
  experienceGapCap?: number | null;
  experienceGapCapApplied?: boolean;
  blendedScoreBeforeCap?: number | null;
  debug?: {
    extractedCanonicals: string[];
    matchedCanonicals: string[];
    missingCanonicals: string[];
    matchedWeight?: number;
    partialWeight?: number;
    rawMissingWeight?: number;
    adjustedMissingWeight?: number;
    bonus?: number;
    clusters?: string[][];
    rawScore?: number;
    calibratedScore?: number | null;
    appliedCap?: number | null;
  };
}

// Session-level cache: key includes job id + scoring mode + dict version + semantic match signature
const scoreCache = new Map<string, ScoringResult>();

const INSUFFICIENT_CACHE_PREFIX = "insufficient|";

function insufficientCacheKey(jobId: string, legacy: boolean): string {
  return `${INSUFFICIENT_CACHE_PREFIX}legacy=${legacy ? "1" : "0"}|d=${DICTIONARY_VERSION}|${jobId}`;
}

export function isResumeMatchScored(result: ScoringResult): boolean {
  return result.matchAvailability === "scored";
}

export function isResumeMatchInsufficientEvidence(result: ScoringResult): boolean {
  return result.matchAvailability === "insufficient_evidence";
}

function gradeFromScore(score: number): ResumeMatchGrade {
  return score >= 75 ? "excellent" : score >= 55 ? "good" : score >= 35 ? "fair" : "poor";
}

/** True when the job exposes at least one scorable signal (dictionary + fallbacks). */
function jobHasMatchSignalsInternal(job: JobItem): boolean {
  if (isResumeLegacyKeywordMode()) {
    return collectLegacyKeywords(job).length > 0;
  }
  return jobHasResolvableMatchSignals(job);
}

function buildInsufficientJobSignalsResult(
  jobId: string,
  unavailableReason: FitUnavailableReason | null = "insufficient_signals",
): ScoringResult {
  const ck = `${insufficientCacheKey(jobId, isLegacyResumeScoring())}|r=${unavailableReason ?? "none"}`;
  const cached = scoreCache.get(ck);
  if (cached) return cached;

  const result: ScoringResult = {
    matchAvailability: "insufficient_job_signals",
    score: null,
    grade: null,
    matched: [],
    missing: [],
    partial: [],
    breakdown: {
      required: { matched: 0, total: 0 },
      preferred: { matched: 0, total: 0 },
    },
    topMissingKeywords: [],
    confidenceLevel: null,
    signalCount: 0,
    fitTier: null,
    unavailableReason,
  };
  scoreCache.set(ck, result);
  return result;
}

function semanticSig(semanticMatches: Record<string, { bullet: string; similarity: number }>): string {
  const entries = Object.entries(semanticMatches).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v.similarity.toFixed(4)}`).join("|");
}

function experienceSig(input?: CandidateExperienceInput): string {
  if (!input) return "exp=none";
  const cand = deriveCandidateExperienceYearsForCache(input);
  return `exp=c${cand ?? "u"}`;
}

function deriveCandidateExperienceYearsForCache(input: CandidateExperienceInput): number | null {
  if (input.yearsOfExperience != null && input.yearsOfExperience > 0) return input.yearsOfExperience;
  const summary = input.applyProfileSummary as { yearsExp?: number | null } | null | undefined;
  if (summary?.yearsExp != null && summary.yearsExp > 0) return summary.yearsExp;
  const exp = input.resumeStructuredV1?.experience;
  if (Array.isArray(exp) && exp.length > 0) return exp.length;
  return null;
}

function cacheKey(
  jobId: string,
  legacy: boolean,
  semanticMatches: Record<string, { bullet: string; similarity: number }>,
  experienceInput?: CandidateExperienceInput,
): string {
  return `v5-exp-cap|soft-v1|legacy=${legacy ? "1" : "0"}|d=${DICTIONARY_VERSION}|${jobId}|${semanticSig(semanticMatches)}|${experienceSig(experienceInput)}`;
}

export function clearScoreCache(): void {
  scoreCache.clear();
}

export function getCachedScore(
  jobId: string,
  semanticMatches: Record<string, { bullet: string; similarity: number }> = {},
): ScoringResult | null {
  return (
    scoreCache.get(cacheKey(jobId, isLegacyResumeScoring(), semanticMatches)) ?? null
  );
}

function isLowConfidenceTitleSignal(source: JobSkill["source"]): boolean {
  return source === "title_family_low";
}

function jobSkillToKeywordResultBase(s: JobSkill): Omit<KeywordResult, "foundIn" | "suggestion"> {
  const isPreferred =
    s.source === "parsed_requirement" ||
    s.source === "sparse_responsibility" ||
    s.source === "description_fallback" ||
    s.source === "title_family_low";
  return {
    keyword: s.canonical,
    category: isPreferred ? "preferred" : "required",
    priority: s.weight >= 0.9 ? 3 : s.weight >= 0.65 ? 2 : 1,
    weight: s.weight,
  };
}

function findMatchCandidateForExcerpt(resumeText: string, canonical: string): string {
  if (resumeTextMatchesKeyword(resumeText, canonical)) return canonical;
  for (const a of ALIASES_BY_CANONICAL[canonical] ?? []) {
    if (resumeTextMatchesKeyword(resumeText, a)) return a;
  }
  return canonical;
}

function textMatchesForCanonicalOrAliases(resumeText: string, canonical: string): boolean {
  if (resumeTextMatchesKeyword(resumeText, canonical)) return true;
  for (const a of ALIASES_BY_CANONICAL[canonical] ?? []) {
    if (resumeTextMatchesKeyword(resumeText, a)) return true;
  }
  return false;
}

type MatchTier = "matched" | "partial" | "missing";

function matchJobSkill(
  resumeText: string,
  skill: JobSkill,
  semanticMatches: Record<string, { bullet: string; similarity: number }>,
): MatchTier {
  if (textMatchesForCanonicalOrAliases(resumeText, skill.canonical)) {
    return "matched";
  }
  const sim = semanticMatches[skill.canonical];
  if (sim && sim.similarity >= 0.65) {
    return "partial";
  }
  return "missing";
}

function extractContextForKeyword(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + keyword.length + 60);
  return `...${text.slice(start, end).replace(/\n/g, " ").trim()}...`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j]! =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function fuzzyMatchExists(text: string, keyword: string): boolean {
  const words = text.split(/\s+/);
  return words.some((word) => levenshtein(word, keyword) <= 1);
}

function sortMissingByWeight(a: JobSkill, b: JobSkill): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.canonical.localeCompare(b.canonical);
}

function scoreResumeSkills(
  resumeText: string,
  _resumeBullets: string[],
  job: JobItem,
  semanticMatches: Record<string, { bullet: string; similarity: number }>,
  experienceInput?: CandidateExperienceInput,
): ScoringResult {
  const resolution = resolveJobMatchSkillsWithMeta(job);
  if (resolution.skills.length === 0 || resolution.unavailableReason) {
    return buildInsufficientJobSignalsResult(job.id, resolution.unavailableReason);
  }
  const skills = resolution.skills;
  const ck = cacheKey(job.id, false, semanticMatches, experienceInput);
  const cached = scoreCache.get(ck);
  if (cached) return cached;

  const matched: KeywordResult[] = [];
  const partial: KeywordResult[] = [];
  const missingUnsorted: { skill: JobSkill; kw: KeywordResult }[] = [];

  for (const s of skills) {
    const base = jobSkillToKeywordResultBase(s);
    const tier = matchJobSkill(resumeText, s, semanticMatches);

    if (tier === "matched") {
      const excerptKey = findMatchCandidateForExcerpt(resumeText, s.canonical);
      matched.push({
        ...base,
        foundIn: extractContextForKeyword(resumeText, excerptKey),
      });
      continue;
    }
    if (tier === "partial") {
      const sem = semanticMatches[s.canonical]!;
      const suggestion = generateSuggestionFromBullet(s.canonical, sem.bullet);
      partial.push({
        ...base,
        closestBullet: sem.bullet,
        suggestion,
        semanticSimilarity: sem.similarity,
        foundIn: "semantic match",
      });
      continue;
    }
    const sem = semanticMatches[s.canonical];
    const suggestion =
      sem && sem.similarity >= 0.45
        ? generateSuggestionFromBullet(s.canonical, sem.bullet)
        : getTemplateSuggestion(s.canonical);
    if (isLowConfidenceTitleSignal(s.source)) {
      continue;
    }
    missingUnsorted.push({
      skill: s,
      kw: {
        ...base,
        suggestion,
        closestBullet: sem?.bullet,
        semanticSimilarity: sem?.similarity,
      },
    });
  }

  const missing = [...missingUnsorted]
    .sort((x, y) => sortMissingByWeight(x.skill, y.skill))
    .map((o) => o.kw);

  const missingSkills = missingUnsorted.map((o) => o.skill);
  const { rawMissingWeight, adjustedMissingWeight, clusters } = computeSofterMissingMass(missingSkills);

  const tiers: MatchTier[] = skills.map((s) => matchJobSkill(resumeText, s, semanticMatches));
  let wMatched = 0;
  let wPartial = 0;
  for (let i = 0; i < skills.length; i++) {
    const t = tiers[i]!;
    const s = skills[i]!;
    if (t === "matched") wMatched += s.weight;
    else if (t === "partial") wPartial += s.weight;
  }
  const totalW = skills.reduce((sum, s) => sum + s.weight, 0);
  const rawScore = computeSofterScorePercent({
    wMatched,
    wPartial,
    totalW,
    adjustedMissingWeight,
  });
  const bonus = computeMatchBonus(wMatched, totalW);
  const calibration = applyCredibilityCalibration({
    rawScore,
    signalCount: resolution.signalCount,
    fitTier: resolution.fitTier,
  });

  const extractedCanonicals = jobSkillCanonicalsForSemantic(skills);
  const missingCanonicals = missing.map((m) => m.keyword);
  const matchedCanonicals = [
    ...matched.map((m) => m.keyword),
    ...partial.map((m) => m.keyword),
  ];

  const isInsufficientEvidence = calibration.outcome === "insufficient_evidence";
  const skillsFitScore = calibration.score;
  const experienceFit = computeExperienceFit(job, experienceInput ?? {});
  const blendedScore = isInsufficientEvidence
    ? null
    : blendSkillsAndExperienceScore(skillsFitScore, experienceFit.experienceFitScore);
  const gapCap = applyExperienceGapCap(
    blendedScore,
    experienceFit.candidateYears,
    experienceFit.requiredYears,
  );
  const finalScore = gapCap.score;

  const result: ScoringResult = {
    matchAvailability: isInsufficientEvidence ? "insufficient_evidence" : "scored",
    score: finalScore,
    grade: finalScore === null ? null : gradeFromScore(finalScore),
    skillsFitScore,
    experienceFitScore: experienceFit.experienceFitScore,
    experienceYearsCandidate: experienceFit.candidateYears,
    experienceYearsRequired: experienceFit.requiredYears,
    experienceGapCap: gapCap.cap,
    experienceGapCapApplied: gapCap.capApplied,
    blendedScoreBeforeCap: blendedScore,
    matched,
    missing,
    partial,
    confidenceLevel: resolution.confidence,
    signalCount: resolution.signalCount,
    fitTier: resolution.fitTier,
    unavailableReason: isInsufficientEvidence ? "insufficient_evidence" : null,
    breakdown: {
      required: {
        matched: matched.filter((k) => k.category === "required").length,
        total: skills.filter(
          (s) =>
            s.source !== "parsed_requirement" &&
            s.source !== "sparse_responsibility" &&
            s.source !== "description_fallback" &&
            s.source !== "title_family_low",
        ).length,
      },
      preferred: {
        matched: matched.filter((k) => k.category === "preferred").length,
        total: skills.filter(
          (s) =>
            s.source === "parsed_requirement" ||
            s.source === "sparse_responsibility" ||
            s.source === "description_fallback" ||
            s.source === "title_family_low",
        ).length,
      },
    },
    topMissingKeywords: missing
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.keyword.localeCompare(b.keyword))
      .slice(0, 10)
      .map((k) => k.keyword),
  };

  if (SCORE_DEBUG) {
    result.debug = {
      extractedCanonicals: [...extractedCanonicals].sort(),
      matchedCanonicals: [...new Set(matchedCanonicals)].sort(),
      missingCanonicals: [...missingCanonicals].sort(),
      matchedWeight: wMatched,
      partialWeight: wPartial,
      rawMissingWeight,
      adjustedMissingWeight,
      bonus,
      clusters,
      rawScore,
      calibratedScore: finalScore,
      appliedCap: calibration.appliedCap,
    };
  }

  scoreCache.set(ck, result);
  return result;
}

function scoreResumeLegacy(
  resumeText: string,
  resumeBullets: string[],
  job: JobItem,
  semanticMatches: Record<string, { bullet: string; similarity: number }> = {},
): ScoringResult {
  const keywords = collectLegacyKeywords(job);
  const resumeLower = resumeText.toLowerCase();
  const ck = cacheKey(job.id, true, semanticMatches);
  const cached = scoreCache.get(ck);
  if (cached) return cached;

  const matched: KeywordResult[] = [];
  const missing: KeywordResult[] = [];
  const partial: KeywordResult[] = [];

  for (const kw of keywords) {
    if (resumeTextMatchesKeyword(resumeText, kw.keyword)) {
      const foundIn = extractContextForKeyword(resumeText, kw.keyword);
      matched.push({ ...kw, foundIn });
      continue;
    }

    if (
      RESUME_FUZZY_ENABLED &&
      kw.keyword.length > 5 &&
      fuzzyMatchExists(resumeLower, kw.keyword.toLowerCase())
    ) {
      partial.push({ ...kw, foundIn: "approximate match found" });
      continue;
    }

    const semantic = semanticMatches[kw.keyword];
    if (semantic && semantic.similarity >= 0.65) {
      const suggestion = generateSuggestionFromBullet(kw.keyword, semantic.bullet);
      partial.push({
        ...kw,
        closestBullet: semantic.bullet,
        suggestion,
        semanticSimilarity: semantic.similarity,
      });
      continue;
    }

    const suggestion =
      semantic && semantic.similarity >= 0.45
        ? generateSuggestionFromBullet(kw.keyword, semantic.bullet)
        : getTemplateSuggestion(kw.keyword);

    missing.push({
      ...kw,
      suggestion,
      closestBullet: semantic?.bullet,
      semanticSimilarity: semantic?.similarity,
    });
  }

  const matchedPts = matched.reduce((s, k) => s + k.priority, 0);
  const partialPts = partial.reduce((s, k) => s + k.priority * 0.6, 0);
  const totalPts = keywords.reduce((s, k) => s + k.priority, 0);
  const score = totalPts === 0 ? 0 : Math.round(((matchedPts + partialPts) / totalPts) * 100);

  const result: ScoringResult = {
    matchAvailability: "scored",
    score,
    grade: score >= 75 ? "excellent" : score >= 55 ? "good" : score >= 35 ? "fair" : "poor",
    matched,
    missing: missing
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10),
    partial,
    breakdown: {
      required: {
        matched: matched.filter((k) => k.category === "required").length,
        total: keywords.filter((k) => k.category === "required").length,
      },
      preferred: {
        matched: matched.filter((k) => k.category === "preferred").length,
        total: keywords.filter((k) => k.category === "preferred").length,
      },
    },
    topMissingKeywords: missing
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5)
      .map((k) => k.keyword),
  };

  if (SCORE_DEBUG) {
    const kws = collectLegacyKeywords(job);
    const keywordStrings = kws.map((k) => k.keyword);
    result.debug = {
      extractedCanonicals: keywordStrings,
      matchedCanonicals: [
        ...matched.map((k) => k.keyword),
        ...partial.map((k) => k.keyword),
      ],
      missingCanonicals: result.missing.map((k) => k.keyword),
    };
  }

  scoreCache.set(ck, result);
  return result;
}

export function scoreResume(
  resumeText: string,
  resumeBullets: string[],
  job: JobItem,
  semanticMatches: Record<string, { bullet: string; similarity: number }> = {},
  experienceInput?: CandidateExperienceInput,
): ScoringResult {
  if (isLegacyResumeScoring()) {
    if (!jobHasMatchSignalsInternal(job)) {
      return buildInsufficientJobSignalsResult(job.id);
    }
    return scoreResumeLegacy(resumeText, resumeBullets, job, semanticMatches);
  }
  return scoreResumeSkills(resumeText, resumeBullets, job, semanticMatches, experienceInput);
}

export type { CandidateExperienceInput } from "./resumeFitExperience";

export function candidateExperienceFromApplyProfile(profile: {
  yearsOfExperience?: number | null;
  currentTitle?: string | null;
  resumeStructuredV1?: unknown;
  applyProfileSummary?: unknown;
} | null | undefined): CandidateExperienceInput {
  if (!profile) return {};
  return {
    yearsOfExperience: profile.yearsOfExperience,
    currentTitle: profile.currentTitle,
    resumeStructuredV1: profile.resumeStructuredV1 as CandidateExperienceInput["resumeStructuredV1"],
    applyProfileSummary: profile.applyProfileSummary as CandidateExperienceInput["applyProfileSummary"],
  };
}

const PHRASE_STOP = new Set(
  `a an the and or but if in on at to for of as is are was were be been being
it its this that these those we you our your they their them
will can could should would may must with from by not no an a
on at has have had
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

function cleanKeywordToken(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[.,;:!?'"()[\]{}]+/g, "")
    .replace(/[.,;:!?'"()[\]{}]+$/g, "")
    .trim();
}

function tokenizeLineForKeywords(line: string): string[] {
  return line
    .replace(/[^a-zA-Z0-9\s\-+#.]/g, " ")
    .split(/\s+/)
    .map((w) => cleanKeywordToken(w))
    .filter((w) => w.length > 1 && !PHRASE_STOP.has(w));
}

function extractRequirementKeywordCandidates(line: string): string[] {
  return tokenizeLineForKeywords(line);
}

function extractNgramPhrasesFromLine(line: string): string[] {
  const words = tokenizeLineForKeywords(line);
  if (words.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i + 2 <= words.length; i++) {
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

function collectLegacyKeywords(
  job: JobItem,
): Omit<KeywordResult, "foundIn" | "suggestion">[] {
  const keywords = new Map<string, Omit<KeywordResult, "foundIn" | "suggestion">>();

  const addKeyword = (word: string, category: "required" | "preferred", priority: 1 | 2 | 3) => {
    const key = normalizeKeywordForMatch(word);
    if (key.length < 2) return;
    if (!keywords.has(key)) {
      keywords.set(key, { keyword: key, category, priority });
    }
  };

  for (const skill of job.skills ?? []) {
    addKeyword(skill, "required", 3);
  }
  for (const tech of job.enriched?.techStack ?? []) {
    addKeyword(tech, "required", 3);
  }
  for (const line of job.parsedDescription?.requirement ?? []) {
    for (const p of extractRequirementKeywordCandidates(line)) {
      addKeyword(p, "required", 2);
    }
  }
  for (const line of job.parsedDescription?.responsibility ?? []) {
    for (const p of extractNgramPhrasesFromLine(line)) {
      addKeyword(p, "preferred", 1);
    }
  }

  return takeTopScorableKeywords([...keywords.values()], MAX_RESUME_MATCH_KEYWORDS);
}

export function extractJobKeywords(
  job: JobItem,
): Omit<KeywordResult, "foundIn" | "suggestion">[] {
  return collectLegacyKeywords(job);
}
