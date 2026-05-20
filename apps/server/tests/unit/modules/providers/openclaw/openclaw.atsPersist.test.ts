import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEndpointDedupeCache,
  shouldSkipOpenClawPersist,
  touchInactiveOpenClawEndpointOnRediscovery,
  workdayBoardKeyFromCandidate,
} from "../../../../../src/modules/providers/providers/openclaw/openclaw.atsPersist.js";
import { buildWorkdaySlug } from "../../../../../src/modules/atsDiscovery/atsUrlParser.js";

describe("buildEndpointDedupeCache", () => {
  test("indexes workday board triple from slug", () => {
    const slug = buildWorkdaySlug({
      host: "abb.wd3.myworkdayjobs.com",
      tenant: "abb",
      site: "abb_careers",
    });
    const cache = buildEndpointDedupeCache([{ type: "workday", slug }]);
    assert.equal(cache.typeSlugKeys.size, 1);
    assert.equal(
      cache.workdayBoardKeys.has("abb.wd3.myworkdayjobs.com\0abb\0abb_careers"),
      true,
    );
  });
});

describe("shouldSkipOpenClawPersist", () => {
  const candidate = {
    type: "greenhouse" as const,
    slug: "acme",
    baseUrl: "https://boards.greenhouse.io/acme",
    crawlToken: "acme",
  };

  test("skips on canonical collision in sync", () => {
    const cache = buildEndpointDedupeCache([]);
    const reason = shouldSkipOpenClawPersist({
      candidate,
      cache,
      canonicalCollision: true,
      dryRun: false,
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
    });
    assert.equal(reason, "collision_in_sync");
  });

  test("skips when type+slug already in cache", () => {
    const cache = buildEndpointDedupeCache([{ type: "greenhouse", slug: "acme" }]);
    const reason = shouldSkipOpenClawPersist({
      candidate,
      cache,
      canonicalCollision: false,
      dryRun: false,
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
    });
    assert.equal(reason, "existing_endpoint");
  });

  test("skips dry run", () => {
    const cache = buildEndpointDedupeCache([]);
    const reason = shouldSkipOpenClawPersist({
      candidate,
      cache,
      canonicalCollision: false,
      dryRun: true,
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
    });
    assert.equal(reason, "dry_run");
  });
});

describe("touchInactiveOpenClawEndpointOnRediscovery", () => {
  test("skips dry run without DB", async () => {
    const result = await touchInactiveOpenClawEndpointOnRediscovery(
      { atsEndpoint: { findUnique: async () => null } } as never,
      {
        candidate: {
          type: "ashby",
          slug: "acme",
          baseUrl: "https://jobs.ashbyhq.com/acme",
          crawlToken: "acme",
        },
        companyId: "c1",
        sourceUrl: "https://jobs.ashbyhq.com/acme/j/1",
        canonicalCollision: false,
        dryRun: true,
      },
    );
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, "dry_run");
  });
});

describe("workdayBoardKeyFromCandidate", () => {
  test("returns stable board key", () => {
    const slug = buildWorkdaySlug({
      host: "cohesity.wd5.myworkdayjobs.com",
      tenant: "cohesity",
      site: "cohesity_careers",
    });
    const key = workdayBoardKeyFromCandidate({
      type: "workday",
      slug,
      baseUrl: "https://cohesity.wd5.myworkdayjobs.com/wday/cxs/cohesity/cohesity_careers/jobs",
      crawlToken: "{}",
    });
    assert.equal(key, "cohesity.wd5.myworkdayjobs.com\0cohesity\0cohesity_careers");
  });
});
