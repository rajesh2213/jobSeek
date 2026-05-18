import type { ResumeMatchGrade, ScoringResult } from "./resumeScorer";

/** Short label (panel header under score ring). */
export function resumeGradeLabel(grade: ResumeMatchGrade | null): string {
  if (grade === null) return "Not enough role details";
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
export function resumeMatchSubtitle(grade: ResumeMatchGrade | null): string {
  if (grade === null) return "We need more detail from this posting to score your fit";
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

export function resumeMatchInsufficientTitle(): string {
  return "Can't score this job yet";
}

export function resumeMatchInsufficientBody(): string {
  return "This listing doesn't include enough recognizable skills for a match score. That's a limitation of the job post, not your resume.";
}

export function isResumeMatchInsufficient(result: ScoringResult): boolean {
  return result.matchAvailability === "insufficient_job_signals";
}
