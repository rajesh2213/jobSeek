import assert from "node:assert/strict";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import { repairWorkdayJob } from "../../../src/services/workdayRepair.service.js";

describe("repairWorkdayJob publishable transition", () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it("invalidates sitemap when job becomes publishable", async () => {
    const sitemapThrottleKeys: string[] = [];
    mock.method(globalThis, "fetch", async () =>
      new Response(
        JSON.stringify({
          jobPostingInfo: {
            jobDescriptionHtml: "<p>" + "description ".repeat(20) + "</p>",
            externalUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Eng_JR1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const redis = {
      set: async (key: string, ..._rest: unknown[]) => {
        if (key.includes("sitemap")) sitemapThrottleKeys.push(key);
        return "OK";
      },
      del: async () => 0,
    };

    const prisma = {
      job: {
        findUnique: async () => ({
          id: "job-1",
          source: "workday",
          sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
          title: "Eng",
          description: "",
          parsedDescription: null,
          companyId: "co-1",
          canonicalJobId: null,
          isPublishable: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          postedAt: null,
          company: { atsBoardToken: null },
        }),
        findMany: async () => [],
        update: async () => ({}),
      },
      atsEndpoint: {
        findFirst: async () => ({
          slug: "acme.wd5.myworkdayjobs.com__acme__Careers",
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };

    const result = await repairWorkdayJob(prisma as never, "job-1", {
      skipJobLock: true,
      redis: redis as never,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.wasPublishable, false);
      assert.equal(result.isPublishable, true);
    }
    assert.ok(sitemapThrottleKeys.length > 0);
  });
});
