import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCOVERY_PREVIEW_ROWS } from "../../../../src/modules/viewCap/discoveryCap.js";
import { LIMITS } from "../../../../src/config/limits.js";

describe("discovery list cap constants", () => {
  it("uses a single free daily limit with env-driven preview rows", () => {
    assert.equal(LIMITS.FREE_TIER_DAILY_LIMIT, 75);
    assert.equal(DISCOVERY_PREVIEW_ROWS, LIMITS.DISCOVERY.PREVIEW_ROWS);
    assert.equal(DISCOVERY_PREVIEW_ROWS > 0, true);
  });
});
