import assert from "node:assert/strict";
import test from "node:test";
import { isJobSeoActive } from "../../../src/services/jobSeoLifecycle.service.js";
import { jobDetailCacheKey } from "../../../src/modules/job/jobDetailCache.js";

const fixedNow = new Date("2026-06-11T12:00:00.000Z");

test("isJobSeoActive rejects inactive jobs", () => {
  assert.equal(isJobSeoActive({ isActive: false, expiresAt: null }, fixedNow), false);
});

test("isJobSeoActive rejects expired jobs", () => {
  assert.equal(
    isJobSeoActive({ isActive: true, expiresAt: "2026-06-01T00:00:00.000Z" }, fixedNow),
    false,
  );
});

test("isJobSeoActive accepts active unexpired jobs", () => {
  assert.equal(
    isJobSeoActive({ isActive: true, expiresAt: "2026-12-31T00:00:00.000Z" }, fixedNow),
    true,
  );
});

test("jobDetailCacheKey is stable and scoped per job id", () => {
  assert.equal(jobDetailCacheKey("abc-123"), "job:detail:v1:abc-123");
});
