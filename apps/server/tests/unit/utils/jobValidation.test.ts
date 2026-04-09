import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isJunkTitle, validateJob } from "../../../src/utils/jobValidation.js";

describe("isJunkTitle", () => {
  it("rejects short titles", () => {
    assert.equal(isJunkTitle("ab"), true);
  });

  it("rejects single 1-3 letter word", () => {
    assert.equal(isJunkTitle("r"), true);
  });

  it("accepts normal titles", () => {
    assert.equal(isJunkTitle("Software Engineer"), false);
  });
});

describe("validateJob", () => {
  it("accepts strong job-like posting", () => {
    const r = validateJob({
      title: "Senior Software Engineer",
      description: "x".repeat(301),
      location: "San Francisco, CA",
      sourceUrl: "https://example.com/jobs/123-apply",
      hasJsonLdJobPosting: true,
    });
    assert.equal(r.isValid, true);
    assert.ok(r.score >= 50);
  });

  it("rejects junk title", () => {
    const r = validateJob({
      title: "r",
      description: "x".repeat(301),
      sourceUrl: "https://example.com/jobs/1",
      hasJsonLdJobPosting: true,
    });
    assert.equal(r.isValid, false);
    assert.ok(r.reasons.includes("junk_title"));
  });

  it("rejects non-job URL path", () => {
    const r = validateJob({
      title: "Engineer",
      description: "x".repeat(301),
      sourceUrl: "https://example.com/blog/careers-post",
    });
    assert.ok(r.reasons.includes("url_non_job_pattern") || r.score < 50);
  });
});
