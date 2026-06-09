export type FitConfidence = "high" | "medium" | "low" | "very_low";

export type FitTier = 1 | 2 | 3 | 4;

export interface FitSignalMetadata {
  confidence: FitConfidence;
  signalCount: number;
  fitTier: FitTier | null;
  sourceBreakdown: {
    taxonomy: number;
    enriched: number;
    parsed: number;
    description: number;
    titleFamily: number;
  };
}

export type FitUnavailableReason =
  | "empty_title"
  | "empty_description"
  | "insufficient_signals"
  | "insufficient_evidence";

export function isLowConfidenceFitTier(tier: FitTier | null | undefined): boolean {
  return tier === 3 || tier === 4;
}

export function confidenceForFitTier(tier: FitTier): FitConfidence {
  if (tier === 1) return "high";
  if (tier === 2) return "medium";
  return "low";
}

export function isTitleFamilyLowTier(tier: FitTier | null | undefined): boolean {
  return tier === 4;
}

export function confidenceLabel(confidence: FitConfidence): string {
  switch (confidence) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Very Low";
  }
}

export function confidenceExplanation(confidence: FitConfidence): string {
  switch (confidence) {
    case "high":
      return "Based on structured job requirements.";
    case "medium":
      return "Based on description analysis.";
    case "low":
      return "Based on limited job signals.";
    default:
      return "Insufficient evidence for a reliable percentage.";
  }
}

export function isVeryLowConfidence(confidence: FitConfidence | null | undefined): boolean {
  return confidence === "very_low";
}
