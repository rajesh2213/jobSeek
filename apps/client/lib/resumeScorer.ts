import type { JobItem } from "./api";
import { generateSuggestionFromBullet, getTemplateSuggestion } from "./keywordSuggestions";
import {
  MAX_RESUME_MATCH_KEYWORDS,
  resumeTextMatchesKeyword,
  takeTopScorableKeywords,
} from "./resumeKeywordFilter";

export interface KeywordResult {
  keyword: string;
  category: "required" | "preferred";
  priority: 1 | 2 | 3;
  // For matched:
  foundIn?: string; // excerpt from resume containing this keyword
  // For missing:
  suggestion?: string; // suggested bullet to add
  closestBullet?: string; // existing resume bullet it was derived from
  semanticSimilarity?: number; // 0-1, how confident the suggestion is
}

export interface ScoringResult {
  score: number;
  grade: "excellent" | "good" | "fair" | "poor"; // ≥75, ≥55, ≥35, <35
  matched: KeywordResult[];
  missing: KeywordResult[];
  partial: KeywordResult[]; // fuzzy/semantic matches
  breakdown: {
    required: { matched: number; total: number };
    preferred: { matched: number; total: number };
  };
  topMissingKeywords: string[]; // top 5 highest-priority missing
}

// Session-level cache: key includes job id + semantic match signature
const scoreCache = new Map<string, ScoringResult>();

function semanticSig(semanticMatches: Record<string, { bullet: string; similarity: number }>): string {
  const entries = Object.entries(semanticMatches).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v.similarity.toFixed(4)}`).join("|");
}

function cacheKey(
  jobId: string,
  semanticMatches: Record<string, { bullet: string; similarity: number }>,
): string {
  return `${jobId}|${semanticSig(semanticMatches)}`;
}

export function clearScoreCache(): void {
  scoreCache.clear();
}

export function getCachedScore(
  jobId: string,
  semanticMatches: Record<string, { bullet: string; similarity: number }> = {},
): ScoringResult | null {
  return scoreCache.get(cacheKey(jobId, semanticMatches)) ?? null;
}

export function scoreResume(
  resumeText: string,
  resumeBullets: string[],
  job: JobItem,
  semanticMatches: Record<string, { bullet: string; similarity: number }> = {},
): ScoringResult {
  const ck = cacheKey(job.id, semanticMatches);
  const cached = scoreCache.get(ck);
  if (cached) return cached;

  const keywords = extractJobKeywords(job);
  const resumeLower = resumeText.toLowerCase();

  const matched: KeywordResult[] = [];
  const missing: KeywordResult[] = [];
  const partial: KeywordResult[] = [];

  for (const kw of keywords) {
    // 1. Match with word boundaries (and tight substring rules for sql/api/…)
    if (resumeTextMatchesKeyword(resumeText, kw.keyword)) {
      const foundIn = extractContext(resumeText, kw.keyword);
      matched.push({ ...kw, foundIn });
      continue;
    }

    // 2. Fuzzy match (Levenshtein ≤ 1 for keywords > 5 chars)
    if (kw.keyword.length > 5 && fuzzyMatchExists(resumeLower, kw.keyword.toLowerCase())) {
      partial.push({ ...kw, foundIn: "approximate match found" });
      continue;
    }

    // 3. Semantic match from pre-fetched results
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

    // 4. Missing — use template suggestion
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

  // Score calculation
  const matchedPts = matched.reduce((s, k) => s + k.priority, 0);
  const partialPts = partial.reduce((s, k) => s + k.priority * 0.6, 0);
  const totalPts = keywords.reduce((s, k) => s + k.priority, 0);
  const score = totalPts === 0 ? 0 : Math.round(((matchedPts + partialPts) / totalPts) * 100);

  const result: ScoringResult = {
    score,
    grade:
      score >= 75 ? "excellent" : score >= 55 ? "good" : score >= 35 ? "fair" : "poor",
    matched,
    missing,
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

  scoreCache.set(ck, result);
  return result;
}

export function extractJobKeywords(
  job: JobItem,
): Omit<KeywordResult, "foundIn" | "suggestion">[] {
  const keywords = new Map<string, Omit<KeywordResult, "foundIn" | "suggestion">>();

  const addKeyword = (word: string, category: "required" | "preferred", priority: 1 | 2 | 3) => {
    const key = word.toLowerCase().trim();
    if (key.length < 2) return;
    if (!keywords.has(key)) {
      keywords.set(key, { keyword: key, category, priority });
    }
  };

  // From skills array → required, priority 3
  for (const skill of job.skills ?? []) {
    addKeyword(skill, "required", 3);
  }

  // From enriched techStack → required, priority 3
  for (const tech of job.enriched?.techStack ?? []) {
    addKeyword(tech, "required", 3);
  }

  // From parsedDescription.requirement lines → short tokens (filtered) + 2-grams
  for (const line of job.parsedDescription?.requirement ?? []) {
    for (const p of extractRequirementKeywordCandidates(line)) {
      addKeyword(p, "required", 2);
    }
  }

  // Responsibility: multi-word phrases only (avoids 100+ spurious "missing" single words)
  for (const line of job.parsedDescription?.responsibility ?? []) {
    for (const p of extractNgramPhrasesFromLine(line, 2, 3)) {
      addKeyword(p, "preferred", 1);
    }
  }

  return takeTopScorableKeywords([...keywords.values()], MAX_RESUME_MATCH_KEYWORDS);
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

function tokenizeLineForKeywords(line: string): string[] {
  return line
    .replace(/[^a-zA-Z0-9\s\-+#.]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 1 && !PHRASE_STOP.has(w));
}

/** Requirement bullets: scorable single tokens + 2-word n-grams (e.g. machine learning). */
function extractRequirementKeywordCandidates(line: string): string[] {
  const words = tokenizeLineForKeywords(line);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
  }
  for (let i = 0; i + 2 <= words.length; i++) {
    const bi = `${words[i]} ${words[i + 1]}`;
    out.push(bi);
  }
  return out;
}

/** Responsibility lines: 2- and 3-word phrases that pass {@link isScorableResumeKeyword} in filter. */
function extractNgramPhrasesFromLine(line: string, nMin: 2, nMax: 3): string[] {
  const words = tokenizeLineForKeywords(line);
  if (words.length < nMin) return [];
  const out: string[] = [];
  for (let n = nMax; n >= nMin; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      out.push(words.slice(i, i + n).join(" "));
    }
  }
  return out;
}

function extractContext(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + keyword.length + 60);
  return `...${text.slice(start, end).replace(/\n/g, " ").trim()}...`;
}

function fuzzyMatchExists(text: string, keyword: string): boolean {
  const words = text.split(/\s+/);
  return words.some((word) => levenshtein(word, keyword) <= 1);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
