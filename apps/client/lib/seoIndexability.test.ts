import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyJobRefinement,
  decideCompanySeoPolicy,
  decideJobsListingSeoPolicy,
  hasUnknownJobQueryParams,
  isSitemapEligibleJobsPath,
} from "./seoIndexability";
import { buildJobsListingUrl, isCanonicalListingPath, parseSlugWithMeta } from "./slug-parser";

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

test("canonical listing path check ignores query strings", () => {
  const categoryHref = buildJobsListingUrl({ category: "engineering" });
  assert.equal(categoryHref, "/jobs/category/engineering?category=engineering");
  assert.equal(isCanonicalListingPath(categoryHref), true);

  const skillHref = buildJobsListingUrl({ skills: ["react"] });
  assert.equal(skillHref, "/jobs/skill/react?skills=react");
  assert.equal(isCanonicalListingPath(skillHref), true);
});

test("category-only slug gets allow_jobs_category_leaf reason", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { category: "engineering" },
    searchParamKeys: [],
    canonicalPath: "/jobs/category/engineering",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, true);
  assert.equal(decision.reason, "allow_jobs_category_leaf");
});

test("location-only slug gets allow_jobs_location_leaf reason", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { country: "US" },
    searchParamKeys: [],
    canonicalPath: "/jobs/location/us",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, true);
  assert.equal(decision.reason, "allow_jobs_location_leaf");

  const remote = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { workType: "remote", isRemote: true },
    searchParamKeys: [],
    canonicalPath: "/jobs/location/remote",
    validCanonicalSlugPath: true,
  });
  assert.equal(remote.index, true);
  assert.equal(remote.reason, "allow_jobs_location_leaf");
});

test("experience-only refinement gets noindex_experience_refinement reason", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "backend-developer", experience: "senior" },
    searchParamKeys: [],
    canonicalPath: "/jobs/role/backend-developer/experience/6-plus-years",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, false);
  assert.equal(decision.reason, "noindex_experience_refinement");
});

test("experience + posted refinement stays noindex_deep_refinement", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "backend-developer", experience: "senior", posted: "1w" },
    searchParamKeys: ["posted"],
    canonicalPath: "/jobs/role/backend-developer/experience/6-plus-years?posted=1w",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, false);
  assert.equal(decision.reason, "noindex_deep_refinement");
});

test("role+location slug keeps allow_jobs_canonical_leaf reason", () => {
  const decision = decideJobsListingSeoPolicy({
    routeKind: "jobs-slug",
    filters: { role: "data-engineer", country: "US" },
    searchParamKeys: [],
    canonicalPath: "/jobs/role/data-engineer/location/us",
    validCanonicalSlugPath: true,
  });
  assert.equal(decision.index, true);
  assert.equal(decision.reason, "allow_jobs_canonical_leaf");
});

test("sitemap eligibility uses specific leaf reasons", () => {
  const catEligible = isSitemapEligibleJobsPath({
    validCanonicalSlugPath: true,
    filters: { category: "data" },
  });
  assert.equal(catEligible.sitemapEligible, true);
  assert.equal(catEligible.reason, "allow_jobs_category_leaf");

  const locEligible = isSitemapEligibleJobsPath({
    validCanonicalSlugPath: true,
    filters: { country: "IN" },
  });
  assert.equal(locEligible.sitemapEligible, true);
  assert.equal(locEligible.reason, "allow_jobs_location_leaf");
});

