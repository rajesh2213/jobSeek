import { isJobReady, type JobItem } from "./api";

/**
 * Rank candidates for "similar jobs" without relying on a tiny random slice.
 * score = sameRole * 3 + sharedSkills * 2 + sameLocation * 1; ties broken by recency.
 */
export function rankSimilarJobs(
  current: JobItem,
  candidates: JobItem[],
  take: number,
): JobItem[] {
  const curSkills = new Set(current.skills.map((s) => s.toLowerCase()));
  const scored = candidates
    .filter(
      (j) =>
        j.id !== current.id &&
        j.companyId !== current.companyId &&
        isJobReady(j),
    )
    .map((j) => {
      let score = 0;
      if (j.role === current.role) score += 3;
      const shared = j.skills.filter((s) => curSkills.has(s.toLowerCase())).length;
      score += shared * 2;
      if (
        current.country &&
        current.country !== "UNKNOWN" &&
        j.country === current.country
      ) {
        score += 1;
      }
      const freshness = new Date(j.effectivePostedAt ?? j.postedAt ?? j.createdAt ?? 0).getTime();
      return { j, score, freshness };
    });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.freshness - a.freshness;
  });
  return scored.slice(0, take).map((x) => x.j);
}
