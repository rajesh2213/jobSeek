import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeInternalRedirectPath,
  resolveJobRedirectTargetPath,
} from "../../../src/services/jobRedirect.service.js";

test("resolveJobRedirectTargetPath prefers role+remote hub", () => {
  assert.equal(
    resolveJobRedirectTargetPath({
      id: "j1",
      role: "software-engineer",
      category: "engineering",
      isRemote: true,
      company: { slug: "acme" },
    }),
    "/jobs/role/software-engineer/location/remote",
  );
});

test("resolveJobRedirectTargetPath falls back to company then /jobs", () => {
  assert.equal(
    resolveJobRedirectTargetPath({
      id: "j2",
      role: "other",
      category: "other",
      company: { slug: "acme" },
    }),
    "/company/acme",
  );
  assert.equal(
    resolveJobRedirectTargetPath({
      id: "j3",
      role: null,
      category: null,
      company: { slug: null },
    }),
    "/jobs",
  );
});

test("isSafeInternalRedirectPath rejects open redirects", () => {
  assert.equal(isSafeInternalRedirectPath("/jobs/role/x"), true);
  assert.equal(isSafeInternalRedirectPath("//evil.com"), false);
  assert.equal(isSafeInternalRedirectPath("https://evil.com"), false);
});
