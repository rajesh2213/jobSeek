/**
 * Lightweight similarity (no external fuzzy libs): token Jaccard on normalized words.
 * Returns 0–1.
 */
export function stringSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(s: string | null | undefined): Set<string> {
  if (!s?.trim()) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

export interface SameJobComparable {
  title: string;
  description?: string | null;
}

/** Optional debug counters for merge gates (ingestion hot path; read rarely). */
export const sameJobMergeRejectCounters = {
  preventedMissingOrShortDescriptions: 0,
  preventedLowDescriptionSimilarity: 0,
  preventedTitleOrDescriptionThreshold: 0,
};

/**
 * Safe merge gate: same fingerprint is not enough — titles and descriptions must align.
 * Apply URL is not part of identity; strong descriptions are required to avoid junk merges.
 */
export function isSameJob(existing: SameJobComparable, incoming: SameJobComparable): boolean {
  const descriptionA = (existing.description ?? "").trim();
  const descriptionB = (incoming.description ?? "").trim();

  const hasStrongDescriptions =
    descriptionA.length > 120 && descriptionB.length > 120;
  if (!hasStrongDescriptions) {
    sameJobMergeRejectCounters.preventedMissingOrShortDescriptions += 1;
    return false;
  }

  const titleSimilarity = stringSimilarity(existing.title, incoming.title);
  const descriptionSimilarity = stringSimilarity(descriptionA, descriptionB);

  if (descriptionA && descriptionB && descriptionSimilarity < 0.65) {
    sameJobMergeRejectCounters.preventedLowDescriptionSimilarity += 1;
    return false;
  }

  const ok = titleSimilarity > 0.9 && descriptionSimilarity > 0.75;
  if (!ok) {
    sameJobMergeRejectCounters.preventedTitleOrDescriptionThreshold += 1;
  }
  return ok;
}
