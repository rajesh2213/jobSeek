import type { FitConfidence, FitTier } from "./resumeFitConfidence";
import {
  confidenceExplanation,
  confidenceLabel,
  isLowConfidenceFitTier,
  isTitleFamilyLowTier,
  isVeryLowConfidence,
} from "./resumeFitConfidence";
import type { ResumeMatchGrade, ScoringResult } from "./resumeScorer";
import { isResumeMatchInsufficientEvidence } from "./resumeScorer";

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
  if (reason === "insufficient_evidence") {
    return "We found some job signals, but not enough for a dependable percentage. Treat this as directional only.";
  }
  return "We couldn't produce a fit estimate for this posting right now.";
}

export function resumeMatchInsufficientEvidenceTitle(): string {
  return "Insufficient evidence for a reliable fit estimate";
}

export function resumeMatchInsufficientEvidenceBody(): string {
  return "We found some job signals, but not enough for a dependable percentage. Treat this as directional only.";
}

export function resumeLowConfidenceEstimateLabel(): string {
  return "Low-confidence estimate";
}

export function shouldEmphasizeConfidenceOverScore(result: ScoringResult): boolean {
  if (isVeryLowConfidence(result.confidenceLevel)) return true;
  return isLowConfidenceFitTier(result.fitTier) && result.matchAvailability === "scored";
}

export function resumeMatchInsufficientHint(): string {
  return "Try another role, or check back on this job later.";
}

export function resumeMatchInsufficientPanelNote(): string {
  return "Re-uploading your resume usually won't change this result for this specific posting.";
}

export function resumeFitConfidenceLine(
  confidence: FitConfidence | null | undefined,
  fitTier?: FitTier | null,
): string | null {
  if (!confidence) return null;
  if (isTitleFamilyLowTier(fitTier)) {
    return "Low confidence estimate — Based primarily on job title.";
  }
  return `Confidence: ${confidenceLabel(confidence)} — ${confidenceExplanation(confidence)}`;
}

export function isResumeMatchInsufficient(result: ScoringResult): boolean {
  return result.matchAvailability === "insufficient_job_signals";
}

export function isResumeMatchUnscorable(result: ScoringResult): boolean {
  return (
    result.matchAvailability === "insufficient_job_signals" ||
    result.matchAvailability === "insufficient_evidence"
  );
}

export { isResumeMatchInsufficientEvidence };
