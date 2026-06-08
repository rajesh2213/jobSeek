export type FitConfidence = "high" | "medium" | "low";

export type FitTier = 1 | 2 | 3;

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
  | "insufficient_signals";

export function confidenceForFitTier(tier: FitTier): FitConfidence {
  if (tier === 1) return "high";
  if (tier === 2) return "medium";
  return "low";
}

export function confidenceLabel(confidence: FitConfidence): string {
  switch (confidence) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    default:
      return "Low";
  }
}

export function confidenceExplanation(confidence: FitConfidence): string {
  switch (confidence) {
    case "high":
      return "Based on structured job requirements.";
    case "medium":
      return "Based on description analysis.";
    default:
      return "Based on limited job signals.";
  }
}
