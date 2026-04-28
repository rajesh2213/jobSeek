import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FREE_DISCOVERY_BONUS_ROWS,
  FREE_DISCOVERY_ROWS_PER_SEARCH,
  FREE_DISCOVERY_SEARCHES,
  isDiscoveryBonusFiveEnabled,
} from "../../../../src/modules/viewCap/discoveryCap.js";

describe("discovery list cap constants", () => {
  it("free tier defaults are env-driven (5x20 + 20 bonus)", () => {
    assert.equal(FREE_DISCOVERY_SEARCHES, 5);
    assert.equal(FREE_DISCOVERY_ROWS_PER_SEARCH, 20);
    assert.equal(FREE_DISCOVERY_BONUS_ROWS, 20);
    assert.equal(
      FREE_DISCOVERY_SEARCHES * FREE_DISCOVERY_ROWS_PER_SEARCH + FREE_DISCOVERY_BONUS_ROWS,
      120,
    );
  });

  it("isDiscoveryBonusFiveEnabled is true unless DISCOVERY_BONUS_FIVE=false", () => {
    const prev = process.env.DISCOVERY_BONUS_FIVE;
    try {
      delete process.env.DISCOVERY_BONUS_FIVE;
      assert.equal(isDiscoveryBonusFiveEnabled(), true);
      process.env.DISCOVERY_BONUS_FIVE = "false";
      assert.equal(isDiscoveryBonusFiveEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.DISCOVERY_BONUS_FIVE;
      else process.env.DISCOVERY_BONUS_FIVE = prev;
    }
  });
});
