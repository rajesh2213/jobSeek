import type { JobSkill } from "./skillExtractor";

export const SIBLING_FACTOR = 0.3;
export const DECAY_STEP = 0.5;
export const BONUS_CAP = 0.1;
export const BONUS_COVERAGE_MULT = 0.2;
export const PREFIX_MIN_LEN = 4;
export const PREFIX_MIN_RATIO = 0.7;
export const LEVENSHTEIN_MIN_KEY_LEN = 6;
export const MAX_LEVENSHTEIN_DIST = 1;

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

function longestCommonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function longestCommonSuffix(a: string, b: string): number {
  let i = a.length - 1;
  let j = b.length - 1;
  let c = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    c++;
    i--;
    j--;
  }
  return c;
}

/**
 * True iff candidate may sit in the same "similarity" cluster as anchor (anchor-only, no chaining).
 * Checks: equality, substring, Levenshtein (strict), prefix ratio, suffix ratio.
 */
export function similarCanonicals(anchor: string, candidate: string): boolean {
  const a = anchor.toLowerCase();
  const b = candidate.toLowerCase();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  if (Math.min(a.length, b.length) >= LEVENSHTEIN_MIN_KEY_LEN && levenshtein(a, b) <= MAX_LEVENSHTEIN_DIST) {
    return true;
  }

  const mink = Math.min(a.length, b.length);
  if (mink >= PREFIX_MIN_LEN) {
    const lcp = longestCommonPrefix(a, b);
    if (lcp / mink >= PREFIX_MIN_RATIO) return true;
    const lcs = longestCommonSuffix(a, b);
    if (lcs / mink >= PREFIX_MIN_RATIO) return true;
  }

  return false;
}

export function sortMissingForClustering(missing: JobSkill[]): JobSkill[] {
  return [...missing].sort((x, y) => y.weight - x.weight || x.canonical.localeCompare(y.canonical));
}

/**
 * Greedy: each cluster is anchored to the first (highest-weight) skill. Members join only if
 * similar to that anchor, never to each other (prevents transitivity).
 */
export function clusterMissingJobSkills(missing: JobSkill[]): JobSkill[][] {
  const sorted = sortMissingForClustering(missing);
  const clusters: JobSkill[][] = [];
  let pool = sorted.slice();
  while (pool.length) {
    const anchorSkill = pool.shift()!;
    const cluster: JobSkill[] = [anchorSkill];
    const anchor = anchorSkill.canonical;
    const rest: JobSkill[] = [];
    for (const t of pool) {
      if (similarCanonicals(anchor, t.canonical)) cluster.push(t);
      else rest.push(t);
    }
    pool = rest;
    clusters.push(cluster);
  }
  return clusters;
}

/** Per missing skill, weight after within-cluster softening. */
function effectiveWeightForInCluster(
  membersSortedByWeightDesc: JobSkill[],
  siblingFactor: number,
): Map<string, number> {
  const m = new Map<string, number>();
  const sorted = [...membersSortedByWeightDesc].sort(
    (a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical),
  );
  sorted.forEach((s, i) => {
    const eff = i === 0 ? s.weight : siblingFactor * s.weight;
    m.set(s.canonical, eff);
  });
  return m;
}

/**
 * `rawMissingWeight`: sum of original JobSkill.weight for every missing item (pre-cluster, pre-decay).
 * `adjustedMissingWeight`: after sibling softening, decay on sorted effective weights.
 */
export function computeSofterMissingMass(missing: JobSkill[]): {
  rawMissingWeight: number;
  adjustedMissingWeight: number;
  clusters: string[][];
} {
  const rawMissingWeight = missing.reduce((s, x) => s + x.weight, 0);
  if (missing.length === 0) {
    return { rawMissingWeight: 0, adjustedMissingWeight: 0, clusters: [] };
  }
  const grouped = clusterMissingJobSkills(missing);
  const clusters = grouped.map((c) => c.map((j) => j.canonical).sort((a, b) => a.localeCompare(b)));
  const byCanonEff = new Map<string, number>();
  for (const c of grouped) {
    const eff = effectiveWeightForInCluster(c, SIBLING_FACTOR);
    for (const [k, v] of eff) byCanonEff.set(k, v);
  }
  const flat: { canonical: string; eff: number }[] = [];
  for (const s of missing) {
    const eff = byCanonEff.get(s.canonical) ?? s.weight;
    flat.push({ canonical: s.canonical, eff });
  }
  flat.sort((a, b) => b.eff - a.eff || a.canonical.localeCompare(b.canonical));
  let adjustedMissingWeight = 0;
  flat.forEach((row, i) => {
    const decay = 1 / (1 + i * DECAY_STEP);
    adjustedMissingWeight += row.eff * decay;
  });
  return { rawMissingWeight, adjustedMissingWeight, clusters };
}

export function computeMatchBonus(wMatched: number, totalW: number): number {
  if (wMatched <= 0 || totalW <= 0) return 0;
  return Math.min(BONUS_CAP, (wMatched / totalW) * BONUS_COVERAGE_MULT);
}

export function computeSofterScorePercent(params: {
  wMatched: number;
  wPartial: number;
  totalW: number;
  adjustedMissingWeight: number;
}): number {
  const { wMatched, wPartial, totalW, adjustedMissingWeight } = params;
  if (totalW === 0) return 0;
  const bonus = computeMatchBonus(wMatched, totalW);
  const num = wMatched + wPartial * 0.6 + bonus;
  const denom = wMatched + wPartial + adjustedMissingWeight;
  if (denom === 0) return 0;
  const pct = (num / denom) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
