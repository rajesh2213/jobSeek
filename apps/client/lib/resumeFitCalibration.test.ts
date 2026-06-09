import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCredibilityCalibration,
  maxAllowedFitScore,
  shouldGateInsufficientEvidence,
} from "./resumeFitCalibration";

test("shouldGateInsufficientEvidence: tier 3/4 with <2 signals", () => {
  assert.equal(shouldGateInsufficientEvidence(1, 3), true);
  assert.equal(shouldGateInsufficientEvidence(1, 4), true);
  assert.equal(shouldGateInsufficientEvidence(2, 3), false);
  assert.equal(shouldGateInsufficientEvidence(1, 2), false);
});

test("applyCredibilityCalibration: rule 3 blocks thin tier 3/4", () => {
  const r = applyCredibilityCalibration({ rawScore: 100, signalCount: 1, fitTier: 3 });
  assert.equal(r.outcome, "insufficient_evidence");
  assert.equal(r.score, null);
});

test("applyCredibilityCalibration: signal and tier caps combine", () => {
  assert.equal(
    applyCredibilityCalibration({ rawScore: 100, signalCount: 2, fitTier: 3 }).score,
    60,
  );
  assert.equal(
    applyCredibilityCalibration({ rawScore: 100, signalCount: 1, fitTier: 2 }).score,
    40,
  );
  assert.equal(
    applyCredibilityCalibration({ rawScore: 100, signalCount: 5, fitTier: 4 }).score,
    60,
  );
  assert.equal(
    applyCredibilityCalibration({ rawScore: 100, signalCount: 5, fitTier: 1 }).score,
    100,
  );
});

test("maxAllowedFitScore matches calibration caps", () => {
  assert.equal(maxAllowedFitScore(1, 3), null);
  assert.equal(maxAllowedFitScore(2, 4), 60);
  assert.equal(maxAllowedFitScore(4, 2), 80);
});
