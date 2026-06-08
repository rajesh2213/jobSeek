import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCOVERY_PREVIEW_ROWS } from "../../../../src/modules/viewCap/discoveryCap.js";
import { LIMITS } from "../../../../src/config/limits.js";

function expectedFreeTierDailyLimitFromEnv(): number {
  const parsed = Number.parseInt(process.env.FREE_TIER_DAILY_LIMIT ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 100;
}

describe("discovery list cap constants", () => {
  it("uses a single free daily limit with env-driven preview rows", () => {
    assert.equal(LIMITS.FREE_TIER_DAILY_LIMIT, expectedFreeTierDailyLimitFromEnv());
    assert.equal(DISCOVERY_PREVIEW_ROWS, LIMITS.DISCOVERY.PREVIEW_ROWS);
    assert.equal(DISCOVERY_PREVIEW_ROWS > 0, true);
  });
});
