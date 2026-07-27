import assert from "node:assert/strict";
import test from "node:test";
import { isJobSeoActive, isJobBusinessOpen } from "../../../src/services/jobSeoLifecycle.service.js";
import { jobDetailCacheKey } from "../../../src/modules/job/jobDetailCache.js";

const fixedNow = new Date("2026-06-11T12:00:00.000Z");

test("isJobSeoActive rejects jobs past SEO grace", () => {
  assert.equal(
    isJobSeoActive({ isActive: false, expiresAt: "2026-05-01T00:00:00.000Z" }, fixedNow),
    false,
  );
});

test("isJobSeoActive accepts expired jobs within grace even when inactive", () => {
  assert.equal(
    isJobSeoActive({ isActive: false, expiresAt: "2026-06-06T00:00:00.000Z" }, fixedNow),
    true,
  );
  assert.equal(
    isJobBusinessOpen({ isActive: false, expiresAt: "2026-06-06T00:00:00.000Z" }, fixedNow),
    false,
  );
});

test("isJobSeoActive accepts active unexpired jobs", () => {
  assert.equal(
    isJobSeoActive({ isActive: true, expiresAt: "2026-12-31T00:00:00.000Z" }, fixedNow),
    true,
  );
});

test("isJobSeoActive without expiresAt respects isActive", () => {
  assert.equal(isJobSeoActive({ isActive: false, expiresAt: null }, fixedNow), false);
  assert.equal(isJobSeoActive({ isActive: true, expiresAt: null }, fixedNow), true);
});

test("jobDetailCacheKey is stable and scoped per job id", () => {
  assert.equal(jobDetailCacheKey("abc-123"), "job:detail:v1:abc-123");
});
