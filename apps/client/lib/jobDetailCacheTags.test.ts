import assert from "node:assert/strict";
import test from "node:test";
import { jobDetailCacheTag, jobDetailPagePath } from "./jobDetailCacheTags";

test("jobDetailCacheTag is scoped per job id", () => {
  assert.equal(jobDetailCacheTag("abc-123"), "job-detail:abc-123");
});

test("jobDetailPagePath maps to job detail route", () => {
  assert.equal(jobDetailPagePath("abc-123"), "/job/abc-123");
});
