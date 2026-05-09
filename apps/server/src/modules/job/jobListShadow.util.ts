/**
 * Internal-only helpers for job list hydrate shadow experiments.
 * Not used on public /jobs responses.
 */

export function jsonStableStringify(value: unknown): string {
  return JSON.stringify(value, stableReplacer);
}

function stableReplacer(_key: string, v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      sorted[k] = o[k];
    }
    return sorted;
  }
  return v;
}

export type JobListJsonDiff = {
  equal: boolean;
  firstMismatchIndex: number | null;
  /** Short diagnostic when equal is false */
  mismatchHint: string | null;
};

export function diffJobListJsonArrays(
  baseline: Record<string, unknown>[],
  other: Record<string, unknown>[],
): JobListJsonDiff {
  if (baseline.length !== other.length) {
    return {
      equal: false,
      firstMismatchIndex: Math.min(baseline.length, other.length),
      mismatchHint: `length ${baseline.length} vs ${other.length}`,
    };
  }
  for (let i = 0; i < baseline.length; i++) {
    const a = jsonStableStringify(baseline[i]);
    const b = jsonStableStringify(other[i]);
    if (a !== b) {
      return {
        equal: false,
        firstMismatchIndex: i,
        mismatchHint: `row ${i} stable-json differs (len ${a.length} vs ${b.length})`,
      };
    }
  }
  return { equal: true, firstMismatchIndex: null, mismatchHint: null };
}
