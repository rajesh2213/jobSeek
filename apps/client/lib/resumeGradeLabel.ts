import type { ScoringResult } from "./resumeScorer";

/** Short label (panel header under score ring). */
export function resumeGradeLabel(grade: ScoringResult["grade"]): string {
  switch (grade) {
    case "excellent":
      return "Strong match";
    case "good":
      return "Good match";
    case "fair":
      return "Fair match";
    default:
      return "Needs work";
  }
}

/** Longer line for job detail match section. */
export function resumeMatchSubtitle(grade: ScoringResult["grade"]): string {
  switch (grade) {
    case "excellent":
      return "Strong match for this role";
    case "good":
      return "Good match for this role";
    case "fair":
      return "Fair match for this role";
    default:
      return "Needs work to match this role";
  }
}
