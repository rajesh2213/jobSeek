import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandLocationFilter,
  getRegions,
  GLOBAL_REGION_LABEL,
  resolveLocation,
} from "../../../src/utils/locationResolver.js";

describe("resolveLocation subnational City, FullRegionName", () => {
  it("resolves US city and full state name", () => {
    const r = resolveLocation("San Francisco, California");
    assert.equal(r.country, "US");
    assert.equal(r.state, "California");
    assert.equal(r.city, "San Francisco");
  });

  it("resolves New York, New York", () => {
    const r = resolveLocation("New York, New York");
    assert.equal(r.country, "US");
    assert.equal(r.state, "New York");
    assert.equal(r.city, "New York");
  });

  it("resolves Canadian province full name", () => {
    const r = resolveLocation("London, Ontario");
    assert.equal(r.country, "CA");
    assert.equal(r.state, "Ontario");
    assert.equal(r.city, "London");
  });

  it("resolves Australian state", () => {
    const r = resolveLocation("Sydney, New South Wales");
    assert.equal(r.country, "AU");
    assert.equal(r.state, "New South Wales");
    assert.equal(r.city, "Sydney");
  });

  it("resolves UK constituent", () => {
    const r = resolveLocation("Edinburgh, Scotland");
    assert.equal(r.country, "GB");
    assert.equal(r.state, "Scotland");
    assert.equal(r.city, "Edinburgh");
  });

  it("resolves German region", () => {
    const r = resolveLocation("Munich, Bavaria");
    assert.equal(r.country, "DE");
    assert.equal(r.state, "Bavaria");
    assert.equal(r.city, "Munich");
  });
});

describe("expandLocationFilter Global region", () => {
  it("includes Global in getRegions", () => {
    assert.ok(getRegions().includes(GLOBAL_REGION_LABEL));
  });

  it('expands "Global" to GLOBAL pseudo-country for filters', () => {
    const codes = expandLocationFilter("Global");
    assert.deepEqual(codes, ["GLOBAL"]);
  });

  it('expands "global" / GLOBAL case-insensitively', () => {
    assert.deepEqual(expandLocationFilter("global"), ["GLOBAL"]);
    assert.deepEqual(expandLocationFilter("GLOBAL"), ["GLOBAL"]);
  });
});
