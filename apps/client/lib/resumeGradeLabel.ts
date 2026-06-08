import type { FitConfidence } from "./resumeFitConfidence";
import { confidenceExplanation, confidenceLabel } from "./resumeFitConfidence";
import type { ResumeMatchGrade, ScoringResult } from "./resumeScorer";

/** Short label (panel header under score ring). */
export function resumeGradeLabel(grade: ResumeMatchGrade | null): string {
  if (grade === null) return "Fit estimate unavailable";
  switch (grade) {
    case "excellent":
      return "Strong fit";
    case "good":
      return "Good fit";
    case "fair":
      return "Fair fit";
    default:
      return "Needs work";
  }
}

/** Longer line for job detail match section. */
export function resumeMatchSubtitle(grade: ResumeMatchGrade | null): string {
  if (grade === null) return "Fit estimate isn't available for this role right now";
  switch (grade) {
    case "excellent":
      return "Strong fit for this role";
    case "good":
      return "Good fit for this role";
    case "fair":
      return "Fair fit for this role";
    default:
      return "Needs work to match this role";
  }
}

export function resumeMatchInsufficientTitle(): string {
  return "Fit estimate unavailable";
}

export function resumeMatchInsufficientBody(reason?: string | null): string {
  if (reason === "empty_title" || reason === "empty_description") {
    return "This job posting doesn't have enough information for a fit estimate. That's a data issue with the listing—not your resume.";
  }
  if (reason === "insufficient_signals") {
    return "We couldn't extract enough job signals from this posting to produce a fit estimate.";
  }
  return "We couldn't produce a fit estimate for this posting right now.";
}

export function resumeMatchInsufficientHint(): string {
  return "Try another role, or check back on this job later.";
}

export function resumeMatchInsufficientPanelNote(): string {
  return "Re-uploading your resume usually won't change this result for this specific posting.";
}

export function resumeFitConfidenceLine(confidence: FitConfidence | null | undefined): string | null {
  if (!confidence) return null;
  return `Confidence: ${confidenceLabel(confidence)} — ${confidenceExplanation(confidence)}`;
}

export function isResumeMatchInsufficient(result: ScoringResult): boolean {
  return result.matchAvailability === "insufficient_job_signals";
}
