import type { JobItem } from "./api";
import { generateSuggestionFromBullet, getTemplateSuggestion } from "./keywordSuggestions";

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
    const kwLower = kw.keyword.toLowerCase();

    // 1. Exact match
    if (resumeLower.includes(kwLower)) {
      const foundIn = extractContext(resumeText, kw.keyword);
      matched.push({ ...kw, foundIn });
      continue;
    }

    // 2. Fuzzy match (Levenshtein ≤ 1 for keywords > 5 chars)
    if (kw.keyword.length > 5 && fuzzyMatchExists(resumeLower, kwLower)) {
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
    if (key.length < 3) return;
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

  // From parsedDescription.requirement lines → extract meaningful phrases
  for (const line of job.parsedDescription?.requirement ?? []) {
    extractPhrasesFromLine(line).forEach((p) => addKeyword(p, "required", 2));
  }

  // From parsedDescription.responsibility lines → preferred
  for (const line of job.parsedDescription?.responsibility ?? []) {
    extractPhrasesFromLine(line).forEach((p) => addKeyword(p, "preferred", 1));
  }

  return [...keywords.values()];
}

// Extract meaningful 1-3 word technical phrases from a line
function extractPhrasesFromLine(line: string): string[] {
  // Remove common filler words
  const STOP_WORDS = new Set([
    "and",
    "or",
    "the",
    "with",
    "for",
    "in",
    "of",
    "to",
    "a",
    "an",
    "you",
    "will",
    "your",
    "our",
    "we",
    "are",
    "is",
    "be",
    "have",
    "has",
    "that",
    "this",
    "from",
    "on",
    "at",
    "by",
    "as",
    "not",
    "but",
    "its",
    "it",
  ]);

  const words = line
    .replace(/[^a-zA-Z0-9\s\-+#.]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return words;
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
