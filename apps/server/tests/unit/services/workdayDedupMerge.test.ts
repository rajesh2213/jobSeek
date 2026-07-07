import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectBestDescription } from "../../../src/services/jobCanonical.service.js";

describe("dedup description merge policy", () => {
  it("prefers incoming when existing empty", () => {
    assert.equal(selectBestDescription("", "Rich incoming description"), "Rich incoming description");
    assert.equal(selectBestDescription(null, "Incoming"), "Incoming");
  });

  it("never replaces richer description with poorer", () => {
    const rich = "A".repeat(500);
    const poor = "short";
    assert.equal(selectBestDescription(rich, poor), rich);
  });

  it("prefers longer when both non-empty", () => {
    assert.equal(selectBestDescription("short", "much longer incoming"), "much longer incoming");
  });
});
