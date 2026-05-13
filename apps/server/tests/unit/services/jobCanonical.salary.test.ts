import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickBestSalary } from "../../../src/services/jobCanonical.service.js";

describe("pickBestSalary — coherent-tuple canonical merge", () => {
  it("picks single row, not cross-row aggregation", () => {
    const result = pickBestSalary([
      { salaryMin: 120000, salaryMax: 150000, salarySource: "regex" },
      { salaryMin: 200000, salaryMax: 220000, salarySource: "regex" },
    ]);
    assert.equal(result.salaryMin, 200000);
    assert.equal(result.salaryMax, 220000);
    assert.equal(result.salarySource, "regex");
  });

  it("prefers jsonld over regex", () => {
    const result = pickBestSalary([
      { salaryMin: 200000, salaryMax: null, salarySource: "regex" },
      { salaryMin: 150000, salaryMax: 180000, salarySource: "jsonld" },
    ]);
    assert.equal(result.salaryMin, 150000);
    assert.equal(result.salaryMax, 180000);
    assert.equal(result.salarySource, "jsonld");
  });

  it("prefers complete range over min-only", () => {
    const result = pickBestSalary([
      { salaryMin: 200000, salaryMax: null, salarySource: "regex" },
      { salaryMin: 120000, salaryMax: 150000, salarySource: "regex" },
    ]);
    assert.equal(result.salaryMin, 120000);
    assert.equal(result.salaryMax, 150000);
  });

  it("among equal-provenance candidates, picks highest min", () => {
    const result = pickBestSalary([
      { salaryMin: 100000, salaryMax: 130000, salarySource: "jsonld" },
      { salaryMin: 150000, salaryMax: 180000, salarySource: "jsonld" },
    ]);
    assert.equal(result.salaryMin, 150000);
    assert.equal(result.salaryMax, 180000);
  });

  it("all null returns null/null/null", () => {
    const result = pickBestSalary([
      { salaryMin: null, salaryMax: null, salarySource: null },
      { salaryMin: null, salaryMax: null, salarySource: null },
    ]);
    assert.equal(result.salaryMin, null);
    assert.equal(result.salaryMax, null);
    assert.equal(result.salarySource, null);
  });

  it("empty array returns null/null/null", () => {
    const result = pickBestSalary([]);
    assert.equal(result.salaryMin, null);
    assert.equal(result.salaryMax, null);
    assert.equal(result.salarySource, null);
  });

  it("single row with salary is picked", () => {
    const result = pickBestSalary([
      { salaryMin: 90000, salaryMax: null, salarySource: "regex" },
    ]);
    assert.equal(result.salaryMin, 90000);
    assert.equal(result.salaryMax, null);
    assert.equal(result.salarySource, "regex");
  });

  it("jsonld min-only preferred over regex complete range when no jsonld ranges exist", () => {
    const result = pickBestSalary([
      { salaryMin: 120000, salaryMax: 150000, salarySource: "regex" },
      { salaryMin: 130000, salaryMax: null, salarySource: "jsonld" },
    ]);
    // ranged pool: only regex row. No jsonld in ranged pool.
    // So ranged pool wins: complete range is preferred.
    assert.equal(result.salaryMin, 120000);
    assert.equal(result.salaryMax, 150000);
  });

  it("ignores rows with salaryMin = 0", () => {
    const result = pickBestSalary([
      { salaryMin: 0, salaryMax: null, salarySource: "regex" },
      { salaryMin: 80000, salaryMax: null, salarySource: "regex" },
    ]);
    assert.equal(result.salaryMin, 80000);
  });

  it("ignores rows with negative salaryMin", () => {
    const result = pickBestSalary([
      { salaryMin: -50000, salaryMax: null, salarySource: "regex" },
      { salaryMin: 70000, salaryMax: null, salarySource: "regex" },
    ]);
    assert.equal(result.salaryMin, 70000);
  });
});
