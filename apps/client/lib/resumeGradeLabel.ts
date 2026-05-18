import type { ResumeMatchGrade, ScoringResult } from "./resumeScorer";

/** Short label (panel header under score ring). */
export function resumeGradeLabel(grade: ResumeMatchGrade | null): string {
  if (grade === null) return "Match unavailable";
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
  if (grade === null) return "AI match analysis isn't available for this role right now";
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
  return "Match unavailable";
}

export function resumeMatchInsufficientBody(): string {
  return "We couldn't run an AI match analysis for this posting right now. That usually means the job description is too thin for our model—not a problem with your resume.";
}

export function resumeMatchInsufficientHint(): string {
  return "Try another role, or check back on this job later.";
}

export function resumeMatchInsufficientPanelNote(): string {
  return "Re-uploading your resume usually won't change this result for this specific posting.";
}

export function isResumeMatchInsufficient(result: ScoringResult): boolean {
  return result.matchAvailability === "insufficient_job_signals";
}
