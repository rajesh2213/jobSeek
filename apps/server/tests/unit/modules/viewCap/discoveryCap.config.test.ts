import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FREE_DISCOVERY_BONUS_ROWS,
  FREE_DISCOVERY_ROWS_PER_SEARCH,
  FREE_DISCOVERY_SEARCHES,
  isDiscoveryBonusFiveEnabled,
} from "../../../../src/modules/viewCap/discoveryCap.js";

describe("discovery list cap constants", () => {
  it("free tier is 2 searches of 10 plus bonus 5 (25 max list rows)", () => {
    assert.equal(FREE_DISCOVERY_SEARCHES, 2);
    assert.equal(FREE_DISCOVERY_ROWS_PER_SEARCH, 10);
    assert.equal(FREE_DISCOVERY_BONUS_ROWS, 5);
    assert.equal(
      FREE_DISCOVERY_SEARCHES * FREE_DISCOVERY_ROWS_PER_SEARCH +
        FREE_DISCOVERY_BONUS_ROWS,
      25,
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
