import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeJobAttributes,
  splitLocations,
} from "../../../src/utils/taxonomyNormalizer.js";

describe("splitLocations", () => {
  it("splits on semicolon and pipe", () => {
    assert.deepEqual(splitLocations("a | b"), ["a", "b"]);
    assert.deepEqual(splitLocations("a; b"), ["a", "b"]);
    assert.deepEqual(splitLocations("London | Berlin | Warsaw"), [
      "London",
      "Berlin",
      "Warsaw",
    ]);
  });
});

describe("normalizeJobAttributes multi-location", () => {
  it('sets primary country DE and hasMultipleLocations for "Berlin | Paris"', () => {
    const r = normalizeJobAttributes({
      title: "Engineer",
      location: "Berlin | Paris",
      isRemote: true,
    });
    assert.equal(r.country, "DE");
    assert.equal(r.hasMultipleLocations, true);
    assert.notEqual(r.country, "GLOBAL");
  });

  it('uses US for "San Francisco; New York" without multi-country flag', () => {
    const r = normalizeJobAttributes({
      title: "Engineer",
      location: "San Francisco; New York",
      isRemote: false,
    });
    assert.equal(r.country, "US");
    assert.equal(r.hasMultipleLocations, undefined);
  });

  it('sets primary DE and hasMultipleLocations for "Berlin | Warsaw"', () => {
    const r = normalizeJobAttributes({
      title: "Engineer",
      location: "Berlin | Warsaw",
      isRemote: true,
    });
    assert.equal(r.country, "DE");
    assert.equal(r.hasMultipleLocations, true);
  });
});
