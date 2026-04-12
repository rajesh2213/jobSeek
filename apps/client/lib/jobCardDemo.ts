/** Stable pseudo-metrics for feed polish (no applicant field on API yet). */

export function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Typical early-listing applicant range for demo animation. */
export function pseudoApplicantCount(jobId: string): number {
  return 3 + (stableHash(jobId) % 46);
}

export function pseudoMatchScore(jobId: string): number {
  return 72 + (stableHash(`${jobId}:match`) % 23);
}

export const MICRO_HINTS = [
  "⚡ Auto-applied in 2 mins (Pro)",
  "🎯 Match insights available",
  "📩 Tracking unlocked with Pro",
] as const;

export function microHintForJob(jobId: string): string {
  return MICRO_HINTS[stableHash(`${jobId}:hint`) % MICRO_HINTS.length];
}
