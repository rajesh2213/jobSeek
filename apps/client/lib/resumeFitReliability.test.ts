import test from "node:test";
import assert from "node:assert/strict";
import { applyFitReliability, deriveHardenedConfidence } from "./resumeFitReliability";
import { computeTitleFit } from "./resumeFitTitle";
import type { JobItem } from "./api";

const job = {
  id: "j",
  title: "Sales Engineer",
  category: "sales",
  role: "sales",
} as JobItem;

test("deriveHardenedConfidence: sparse tier 3", () => {
  const titleFit = computeTitleFit(job, { currentTitle: "Backend Engineer" });
  const conf = deriveHardenedConfidence({
    baseConfidence: "low",
    fitTier: 3,
    signalCount: 2,
    titleFit,
  });
  assert.equal(conf, "very_low");
});

test("deriveHardenedConfidence: title family mismatch", () => {
  const titleFit = computeTitleFit(job, { currentTitle: "Backend Engineer" });
  const conf = deriveHardenedConfidence({
    baseConfidence: "medium",
    fitTier: 2,
    signalCount: 5,
    titleFit,
  });
  assert.equal(conf, "very_low");
});

test("applyFitReliability gates unavailable on family mismatch", () => {
  const titleFit = computeTitleFit(job, { currentTitle: "Backend Engineer" });
  const result = applyFitReliability({
    baseConfidence: "medium",
    fitTier: 2,
    signalCount: 5,
    titleFit,
  });
  assert.equal(result.confidence, "very_low");
  assert.equal(result.gateUnavailable, true);
  assert.equal(result.unavailableReason, "insufficient_evidence");
});

test("applyFitReliability does not gate when candidate title unknown", () => {
  const titleFit = computeTitleFit(job, {});
  const result = applyFitReliability({
    baseConfidence: "medium",
    fitTier: 2,
    signalCount: 5,
    titleFit,
  });
  assert.equal(result.gateUnavailable, false);
});
