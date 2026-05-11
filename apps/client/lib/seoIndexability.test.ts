import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyJobRefinement,
  decideCompanySeoPolicy,
  decideJobsListingSeoPolicy,
  hasUnknownJobQueryParams,
  isSitemapEligibleJobsPath,
} from "./seoIndexability";
import { parseSlugWithMeta } from "./slug-parser";

test("unknown query params default to disallowed/noindex", () => {
  assert.equal(hasUnknownJobQueryParams(["foo"]), true);
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-root",
    filters: {},
    searchParamKeys: ["foo"],
    canonicalPath: "/jobs",
  });
  assert.equal(decision.index, false);
  assert.equal(decision.follow, true);
  assert.equal(decision.reason, "noindex_disallowed_param");
});

test("jobs root without query remains allowlisted", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-root",
    filters: {},
    searchParamKeys: [],
    canonicalPath: "/jobs",
  });
  assert.equal(decision.index, true);
  assert.equal(decision.sitemapEligible, true);
  assert.equal(decision.reason, "allow_jobs_root");
});

test("jobs root with query canonicalizes and noindexes", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-root",
    filters: { role: "backend-developer" },
    searchParamKeys: ["role"],
    canonicalPath: "/jobs/role/backend-developer",
  });
  assert.equal(decision.index, false);
  assert.equal(decision.reason, "canonicalize_jobs_query_to_slug");
  assert.equal(decision.canonicalTarget, "/jobs/role/backend-developer");
});

test("pagination and refinement-heavy states noindex", () => {
  const paginated = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "backend-developer", page: 2 },
    searchParamKeys: ["page"],
    canonicalPath: "/jobs/role/backend-developer?page=2",
    validCanonicalSlugPath: true,
  });
  assert.equal(paginated.reason, "noindex_pagination");

  const deep = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "backend-developer", posted: "1w" },
    searchParamKeys: ["posted"],
    canonicalPath: "/jobs/role/backend-developer?posted=1w",
    validCanonicalSlugPath: true,
  });
  assert.equal(deep.reason, "noindex_deep_refinement");
});

test("canonical slug leaf allowlisted with deterministic shape", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "backend-developer" },
    searchParamKeys: [],
    canonicalPath: "/jobs/role/backend-developer",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, true);
  assert.equal(decision.reason, "allow_jobs_canonical_leaf");
});

test("non-canonical slug path canonicalizes", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: {},
    searchParamKeys: [],
    canonicalPath: "/jobs",
    validCanonicalSlugPath: false,
  });
  assert.equal(decision.index, false);
  assert.equal(decision.reason, "canonicalize_noncanonical_slug");
});

test("company policy stays conservative by default", () => {
  const decision = decideCompanySeoPolicy({
    gateEnabled: true,
    company: { id: "c1", name: "Acme", slug: "acme" },
    requestedSlug: "acme",
  });
  assert.equal(decision.index, true);
  assert.equal(decision.reason, "allow_company_default");
});

test("company policy only noindexes obviously broken states", () => {
  const broken = decideCompanySeoPolicy({
    gateEnabled: true,
    company: { id: "c1", name: "Acme", slug: "other" },
    requestedSlug: "acme",
  });
  assert.equal(broken.index, false);
  assert.equal(broken.reason, "noindex_company_broken");
});

test("sitemap eligibility excludes non-canonical and refinement-heavy", () => {
  const parsedOk = parseSlugWithMeta(["role", "backend-developer"]);
  const ok = isSitemapEligibleJobsPath({
    validCanonicalSlugPath: parsedOk.validCanonical,
    filters: parsedOk.filters,
  });
  assert.equal(ok.sitemapEligible, true);

  const parsedBad = parseSlugWithMeta(["engineering-remote"]);
  const bad = isSitemapEligibleJobsPath({
    validCanonicalSlugPath: parsedBad.validCanonical,
    filters: parsedBad.filters,
  });
  assert.equal(bad.sitemapEligible, false);

  const refined = isSitemapEligibleJobsPath({
    validCanonicalSlugPath: true,
    filters: { role: "backend-developer", sort: "salary_desc" },
  });
  assert.equal(refined.sitemapEligible, false);
});

test("refinement classifier treats multi-filters as deep refinement", () => {
  const out = classifyJobRefinement({
    roles: ["backend-developer", "frontend-engineer"],
    skills: ["react", "nodejs"],
  });
  assert.equal(out.hasDeepRefinement, true);
  assert.equal(out.hasPagination, false);
  assert.equal(out.hasDisallowedParam, false);
});

