import type { FitTier } from "./resumeFitConfidence";

export type CredibilityOutcome = "scored" | "insufficient_evidence";

export interface CredibilityCalibrationInput {
  rawScore: number;
  signalCount: number;
  fitTier: FitTier | null;
}

export interface CredibilityCalibrationResult {
  outcome: CredibilityOutcome;
  score: number | null;
  /** Effective cap after rules 1 + 2; null when insufficient evidence. */
  appliedCap: number | null;
}

/** Rule 1: signal-count ceiling (null = no cap from this rule). */
export function signalCountScoreCap(signalCount: number): number | null {
  if (signalCount <= 0) return 0;
  if (signalCount === 1) return 40;
  if (signalCount === 2) return 60;
  if (signalCount <= 4) return 80;
  return null;
}

/** Rule 2: tier ceiling (null = no cap from this rule). */
export function fitTierScoreCap(fitTier: FitTier | null): number | null {
  if (fitTier === 1) return null;
  if (fitTier === 2) return 95;
  if (fitTier === 3) return 75;
  if (fitTier === 4) return 60;
  return null;
}

/** Combined max allowed score; null when Rule 3 blocks numeric output. */
export function maxAllowedFitScore(signalCount: number, fitTier: FitTier | null): number | null {
  if (signalCount < 2 && fitTier !== null && fitTier >= 3) return null;

  let cap = 100;
  const signalCap = signalCountScoreCap(signalCount);
  if (signalCap !== null) cap = Math.min(cap, signalCap);
  const tierCap = fitTierScoreCap(fitTier);
  if (tierCap !== null) cap = Math.min(cap, tierCap);
  return cap;
}

/** Rule 3: thin evidence on title-family tiers → no numeric score. */
export function shouldGateInsufficientEvidence(
  signalCount: number,
  fitTier: FitTier | null,
): boolean {
  return signalCount < 2 && fitTier !== null && fitTier >= 3;
}

export function applyCredibilityCalibration(
  input: CredibilityCalibrationInput,
): CredibilityCalibrationResult {
  const { rawScore, signalCount, fitTier } = input;

  if (shouldGateInsufficientEvidence(signalCount, fitTier)) {
    return { outcome: "insufficient_evidence", score: null, appliedCap: null };
  }

  const cap = maxAllowedFitScore(signalCount, fitTier);
  if (cap === null) {
    return { outcome: "insufficient_evidence", score: null, appliedCap: null };
  }

  return {
    outcome: "scored",
    score: Math.max(0, Math.min(100, Math.round(Math.min(rawScore, cap)))),
    appliedCap: cap,
  };
}
