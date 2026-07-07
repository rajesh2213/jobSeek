import assert from "node:assert/strict";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import { Prisma } from "@prisma/client";
import { repairWorkdayJob } from "../../../src/services/workdayRepair.service.js";

const TARGET_URL = "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Eng_JR1";
const POISON_URL = "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1";

function mockFetchDetail() {
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        jobPostingInfo: {
          jobDescriptionHtml: "<p>" + "description ".repeat(20) + "</p>",
          externalUrl: TARGET_URL,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("repairWorkdayJob integration", () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it("merges into existing sibling on sourceUrl collision", async () => {
    mockFetchDetail();

    const updates: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      job: {
        findUnique: async (args: { where: { id?: string; sourceUrl?: string } }) => {
          if (args.where.id === "job-poison") {
            return {
              id: "job-poison",
              source: "workday",
              sourceUrl: POISON_URL,
              title: "Eng",
              description: "",
              parsedDescription: null,
              companyId: "co-1",
              canonicalJobId: null,
              isPublishable: false,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              postedAt: null,
              company: { atsBoardToken: null },
            };
          }
          if (args.where.sourceUrl === TARGET_URL || args.where.id === "job-healthy") {
            return {
              id: "job-healthy",
              canonicalJobId: null,
              isPublishable: true,
              source: "workday",
              sourceUrl: TARGET_URL,
              description: "Existing description",
              parsedDescription: null,
              title: "Eng",
              applyUrl: TARGET_URL,
              companyId: "co-1",
              country: "US",
              category: "other",
              isRemote: false,
              workType: "onsite",
              postedAt: null,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              freshnessScore: 0,
              sourceWeight: 0.7,
              role: "other",
              skills: [],
              salaryMin: null,
              salaryMax: null,
              salarySource: null,
            };
          }
          return null;
        },
        findMany: async () => [],
        update: async (args: { where: unknown; data: unknown }) => {
          updates.push(args);
          return {};
        },
      },
      atsEndpoint: {
        findFirst: async () => ({
          slug: "acme.wd5.myworkdayjobs.com__acme__Careers",
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };

    const result = await repairWorkdayJob(prisma as never, "job-poison", {
      skipJobLock: true,
    });
    assert.equal(result.ok, true);
    const linked = updates.find(
      (u) =>
        (u.where as { id?: string }).id === "job-poison" &&
        (u.data as { canonicalJobId?: string }).canonicalJobId === "job-healthy",
    );
    assert.ok(linked, "poisoned row should link to healthy sibling");
    assert.equal(
      (linked!.data as { requiresRepair?: boolean }).requiresRepair,
      false,
    );
  });

  it("returns unresolved collision when sibling cannot be found", async () => {
    mockFetchDetail();

    const prisma = {
      job: {
        findUnique: async (args: { where: { id?: string; sourceUrl?: string } }) => {
          if (args.where.id === "job-1") {
            return {
              id: "job-1",
              source: "workday",
              sourceUrl: POISON_URL,
              title: "Eng",
              description: "",
              parsedDescription: null,
              companyId: "co-1",
              canonicalJobId: null,
              isPublishable: false,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              postedAt: null,
              company: { atsBoardToken: null },
            };
          }
          return null;
        },
        update: async () => {
          throw new Prisma.PrismaClientKnownRequestError("collision", {
            code: "P2002",
            clientVersion: "test",
          });
        },
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
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "source_url_collision");
  });

  it("is no-op when already repaired", async () => {
    const prisma = {
      job: {
        findUnique: async () => ({
          id: "job-1",
          source: "workday",
          sourceUrl: TARGET_URL,
          title: "Eng",
          description: "Already has description",
          parsedDescription: null,
          companyId: "co-1",
          canonicalJobId: null,
          isPublishable: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          postedAt: null,
          company: { atsBoardToken: null },
        }),
      },
      atsEndpoint: { findFirst: async () => null },
    };
    const result = await repairWorkdayJob(prisma as never, "job-1", {
      skipJobLock: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_poisoned");
  });
});
