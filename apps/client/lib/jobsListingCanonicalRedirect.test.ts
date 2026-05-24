import assert from "node:assert/strict";
import test from "node:test";
import {
  isJobsListingRedirectPath,
  resolveJobsListingCanonicalRedirectUrl,
} from "./jobsListingCanonicalRedirect";

const ORIGIN = "https://www.jobloom.tech";

test("isJobsListingRedirectPath excludes browse", () => {
  assert.equal(isJobsListingRedirectPath("/jobs/browse"), false);
  assert.equal(isJobsListingRedirectPath("/jobs/skill/typescript"), true);
  assert.equal(isJobsListingRedirectPath("/jobs"), true);
});

test("strips redundant skills query on skill slug", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(
    ORIGIN,
    "/jobs/skill/typescript",
    { skills: "typescript" },
  );
  assert.equal(dest, `${ORIGIN}/jobs/skill/typescript`);
});

test("redirects /jobs?skills= to skill hub slug", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(ORIGIN, "/jobs", {
    skills: "typescript",
  });
  assert.equal(dest, `${ORIGIN}/jobs/skill/typescript`);
});

test("strips redundant category query on category slug", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(
    ORIGIN,
    "/jobs/category/engineering",
    { category: "engineering" },
  );
  assert.equal(dest, `${ORIGIN}/jobs/category/engineering`);
});

test("no redirect when canonical matches incoming", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(
    ORIGIN,
    "/jobs/skill/typescript",
    {},
  );
  assert.equal(dest, null);
});

test("no redirect for /jobs/browse path", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(ORIGIN, "/jobs/browse", {});
  assert.equal(dest, null);
});

test("no redirect for browse path", () => {
  const dest = resolveJobsListingCanonicalRedirectUrl(ORIGIN, "/jobs/browse", {
    skills: "typescript",
  });
  assert.equal(dest, null);
});
