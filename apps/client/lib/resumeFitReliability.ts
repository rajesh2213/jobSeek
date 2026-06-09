import type { FitConfidence, FitTier } from "./resumeFitConfidence";
import { isTitleFamilyMismatch, type TitleFitResult } from "./resumeFitTitle";

export interface ReliabilityInput {
  baseConfidence: FitConfidence | null;
  fitTier: FitTier | null;
  signalCount: number;
  titleFit: TitleFitResult;
}

export interface ReliabilityResult {
  confidence: FitConfidence | null;
  showNumericScore: boolean;
  gateUnavailable: boolean;
  unavailableReason: "insufficient_evidence" | null;
}

export function deriveHardenedConfidence(input: ReliabilityInput): FitConfidence | null {
  const { baseConfidence, fitTier, signalCount, titleFit } = input;
  if (!baseConfidence) return null;

  if (fitTier != null && fitTier >= 3 && signalCount < 3) return "very_low";

  if (titleFit.candidateFamily != null && titleFit.jobFamily != null) {
    if (
      isTitleFamilyMismatch(titleFit.candidateFamily, titleFit.jobFamily) &&
      (titleFit.titleFitScore ?? 0) < 40
    ) {
      return "very_low";
    }
    return baseConfidence;
  }

  if (
    titleFit.jobFamily != null &&
    titleFit.candidateSource != null &&
    titleFit.candidateFamily == null
  ) {
    return "very_low";
  }

  return baseConfidence;
}

function shouldGateForReliability(input: ReliabilityInput): boolean {
  const { fitTier, signalCount, titleFit } = input;
  if (signalCount < 2) return true;
  if (fitTier != null && fitTier >= 3 && signalCount < 3) return true;
  if (
    titleFit.candidateFamily != null &&
    titleFit.jobFamily != null &&
    isTitleFamilyMismatch(titleFit.candidateFamily, titleFit.jobFamily) &&
    (titleFit.titleFitScore ?? 0) < 40
  ) {
    return true;
  }
  if (
    titleFit.jobFamily != null &&
    titleFit.candidateSource != null &&
    titleFit.candidateFamily == null
  ) {
    return true;
  }
  return false;
}

export function applyFitReliability(input: ReliabilityInput): ReliabilityResult {
  const confidence = deriveHardenedConfidence(input);
  const gateUnavailable = shouldGateForReliability(input);

  return {
    confidence,
    showNumericScore: !gateUnavailable,
    gateUnavailable,
    unavailableReason: gateUnavailable ? "insufficient_evidence" : null,
  };
}
