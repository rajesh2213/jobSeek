import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLikelyAtsPage } from "../../src/lib/atsDetection.ts";

describe("isLikelyAtsPage", () => {
  it("returns false for invalid URLs", () => {
    assert.equal(isLikelyAtsPage(""), false);
    assert.equal(isLikelyAtsPage("not-a-url"), false);
  });

  it("returns true for known ATS hostnames", () => {
    assert.equal(isLikelyAtsPage("https://boards.greenhouse.io/acme/jobs/1"), true);
    assert.equal(isLikelyAtsPage("https://myworkdayjobs.com/Acme/job/1"), true);
    assert.equal(isLikelyAtsPage("https://jobs.lever.co/acme"), true);
    assert.equal(isLikelyAtsPage("https://jobs.ashbyhq.com/acme"), true);
  });

  it("returns true for Greenhouse query params on employer domains", () => {
    assert.equal(isLikelyAtsPage("https://careers.example.com/jobs?gh_jid=123"), true);
    assert.equal(isLikelyAtsPage("https://example.com/apply?gh_src=abc"), true);
    assert.equal(isLikelyAtsPage("https://example.com/apply?gh_ll=1"), true);
  });

  it("returns true for Greenhouse embed hash markers", () => {
    assert.equal(isLikelyAtsPage("https://asana.com/jobs/apply#grnhse_app"), true);
    assert.equal(isLikelyAtsPage("https://example.com/page?x=1&grnhse=1"), true);
  });

  it("returns false for generic sites without ATS signals", () => {
    assert.equal(isLikelyAtsPage("https://example.com/careers"), false);
    assert.equal(isLikelyAtsPage("https://google.com/search?q=jobs"), false);
  });
});
