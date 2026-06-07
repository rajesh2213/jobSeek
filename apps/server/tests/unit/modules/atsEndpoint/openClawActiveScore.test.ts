import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOpenClawActiveScoreFloor,
  isOpenClawActiveEndpoint,
  isOpenClawPastActiveCrawlCooldown,
  openClawActiveCrawlCooldownMs,
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

  test("isOpenClawPastActiveCrawlCooldown", () => {
    const prev = process.env.OPENCLAW_ACTIVE_CRAWL_COOLDOWN_MS;
    process.env.OPENCLAW_ACTIVE_CRAWL_COOLDOWN_MS = String(4 * 60 * 60 * 1000);
    try {
      const now = Date.now();
      assert.equal(isOpenClawPastActiveCrawlCooldown(null, now), true);
      assert.equal(
        isOpenClawPastActiveCrawlCooldown(new Date(now - 5 * 60 * 60 * 1000), now),
        true,
      );
      assert.equal(
        isOpenClawPastActiveCrawlCooldown(new Date(now - 1 * 60 * 60 * 1000), now),
        false,
      );
      assert.equal(openClawActiveCrawlCooldownMs(), 4 * 60 * 60 * 1000);
    } finally {
      if (prev === undefined) delete process.env.OPENCLAW_ACTIVE_CRAWL_COOLDOWN_MS;
      else process.env.OPENCLAW_ACTIVE_CRAWL_COOLDOWN_MS = prev;
    }
  });
});
