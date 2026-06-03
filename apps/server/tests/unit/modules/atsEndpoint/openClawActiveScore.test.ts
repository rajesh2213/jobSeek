import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOpenClawActiveScoreFloor,
  isOpenClawActiveEndpoint,
  openClawSchedulerPriorityBoost,
} from "../../../../src/modules/atsEndpoint/openClawActiveScore.js";

describe("openClawActiveScore", () => {
  test("isOpenClawActiveEndpoint", () => {
    assert.equal(isOpenClawActiveEndpoint("openclaw", true), true);
    assert.equal(isOpenClawActiveEndpoint("openclaw", false), false);
    assert.equal(isOpenClawActiveEndpoint("enrichment", true), false);
  });

  test("applyOpenClawActiveScoreFloor raises active openclaw only", () => {
    const prev = process.env.OPENCLAW_ACTIVE_MIN_SCORE;
    process.env.OPENCLAW_ACTIVE_MIN_SCORE = "80";
    try {
      assert.equal(applyOpenClawActiveScoreFloor(62, "openclaw", true), 80);
      assert.equal(applyOpenClawActiveScoreFloor(90, "openclaw", true), 90);
      assert.equal(applyOpenClawActiveScoreFloor(62, "enrichment", true), 62);
      assert.equal(applyOpenClawActiveScoreFloor(62, "openclaw", false), 62);
    } finally {
      if (prev === undefined) delete process.env.OPENCLAW_ACTIVE_MIN_SCORE;
      else process.env.OPENCLAW_ACTIVE_MIN_SCORE = prev;
    }
  });

  test("openClawSchedulerPriorityBoost", () => {
    assert.equal(openClawSchedulerPriorityBoost("openclaw", true), 500);
    assert.equal(openClawSchedulerPriorityBoost("job", true), 0);
  });
});
