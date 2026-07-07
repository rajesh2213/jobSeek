import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  computePersistedContentHash,
  finalizeHashCacheHitAfterRecovery,
  recoverWorkdayOnHashCacheHit,
} from "../../../src/utils/workdayHashCacheRecovery.js";

describe("hash cache recovery ordering", () => {
  it("computePersistedContentHash uses DB description after merge", async () => {
    const db = {
      job: {
        findUnique: async () => ({
          title: "Engineer",
          description: "Recovered description text",
          applyUrl: "https://example.com/apply",
          sourceUrl: "https://example.com/job/1",
        }),
      },
    } as unknown as Pick<PrismaClient, "job">;

    const hash = await computePersistedContentHash(db, "https://example.com/job/1", {
      sourceUrl: "https://example.com/job/1",
      source: "workday",
      title: "Engineer",
      description: "",
    });
    assert.notEqual(hash.length, 0);
    assert.notEqual(hash, "empty");
  });
});

describe("recoverWorkdayOnHashCacheHit", () => {
  beforeEach(() => mock.restoreAll());

  it("does not inline repair unless explicitly enabled", async () => {
    const db = {
      job: {
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => ({
          id: "j1",
          source: "workday",
          sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
          title: "Eng",
          description: "",
          applyUrl: null,
          canonicalJobId: null,
          parsedDescription: null,
        }),
        update: async () => ({}),
      },
    } as unknown as Pick<PrismaClient, "job">;

    const result = await recoverWorkdayOnHashCacheHit(
      db,
      {
        sourceUrl: "https://acme.wd5.myworkdayjobs.com/job/Eng_JR1",
        source: "workday",
        title: "Eng",
        description: "",
      },
      null,
      { attemptInlineRepair: false },
    );

    assert.equal(result.detailRepaired, false);
  });
});

describe("finalizeHashCacheHitAfterRecovery", () => {
  it("returns bypass when incoming has richer description", async () => {
    const prisma = {
      job: {
        findUnique: async () => ({ description: "" }),
      },
    } as unknown as PrismaClient;
    const redis = {
      set: async () => "OK",
    } as unknown as import("ioredis").Redis;

    const action = await finalizeHashCacheHitAfterRecovery(prisma, redis, {
      hashCacheKey: "k",
      hashCacheTtlSeconds: 60,
      processedAt: new Date(),
      job: {
        sourceUrl: "https://x/job/1",
        source: "workday",
        title: "T",
        description: "Incoming rich description body",
      },
      inlineRepairEnabled: false,
    });
    assert.equal(action, "bypass_ingest");
  });
});
