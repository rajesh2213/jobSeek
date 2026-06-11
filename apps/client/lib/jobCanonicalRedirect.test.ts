import assert from "node:assert/strict";
import test from "node:test";
import {
  isJobUuidSegment,
  resolveJobAliasRedirectPath,
  resolveJobDetailCanonicalRedirectUrl,
  resolveJobsUuidMispathRedirectUrl,
} from "./jobCanonicalRedirect";

const ORIGIN = "https://www.jobloom.tech";
const SAMPLE_UUID = "4409fb0f-a1b2-4c3d-9e8f-123456789abc";

test("isJobUuidSegment accepts RFC4122 ids", () => {
  assert.equal(isJobUuidSegment(SAMPLE_UUID), true);
  assert.equal(isJobUuidSegment("typescript"), false);
  assert.equal(isJobUuidSegment("backend-developer"), false);
});

test("redirects /jobs/{uuid} to /job/{uuid}", () => {
  const dest = resolveJobsUuidMispathRedirectUrl(ORIGIN, `/jobs/${SAMPLE_UUID}`);
  assert.equal(dest, `${ORIGIN}/job/${SAMPLE_UUID}`);
});

test("does not redirect multi-segment /jobs paths", () => {
  assert.equal(resolveJobsUuidMispathRedirectUrl(ORIGIN, "/jobs/skill/typescript"), null);
  assert.equal(resolveJobsUuidMispathRedirectUrl(ORIGIN, "/jobs/browse"), null);
});

test("strips query params from job detail canonical", () => {
  const dest = resolveJobDetailCanonicalRedirectUrl(ORIGIN, `/job/${SAMPLE_UUID}`, {
    utm_source: "google",
    gclid: "abc",
  });
  assert.equal(dest, `${ORIGIN}/job/${SAMPLE_UUID}`);
});

test("no redirect when job detail has no query", () => {
  const dest = resolveJobDetailCanonicalRedirectUrl(ORIGIN, `/job/${SAMPLE_UUID}`, {});
  assert.equal(dest, null);
});

test("resolveJobAliasRedirectPath redirects duplicate id to canonical id", () => {
  const canonical = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const duplicate = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.equal(resolveJobAliasRedirectPath(canonical, canonical), null);
  assert.equal(resolveJobAliasRedirectPath(duplicate, canonical), `/job/${canonical}`);
});

test("resolveJobAliasRedirectPath is case-insensitive for UUIDs", () => {
  const upper = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  const lower = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  assert.equal(resolveJobAliasRedirectPath(upper, lower), null);
  assert.equal(resolveJobAliasRedirectPath(lower, upper), null);
});
