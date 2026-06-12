import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { recoverWorkdayPostedAtOnHashCacheHit } from "../../../src/utils/workdayPostedAtHashHitRecovery.js";

function mockPrisma(updateCount: number) {
  let callCount = 0;
  let lastArgs: { where: unknown; data: unknown } | undefined;
  const prisma = {
    job: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        callCount += 1;
        lastArgs = args;
        return { count: updateCount };
      },
    },
  } as unknown as Pick<PrismaClient, "job">;
  return {
    prisma,
    getCallCount: () => callCount,
    getLastArgs: () => lastArgs,
  };
}

describe("recoverWorkdayPostedAtOnHashCacheHit", () => {
  const sourceUrl = "https://acme.myworkdayjobs.com/en-US/careers/job/eng";
  const candidate = new Date("2026-06-01T00:00:00.000Z");

  it("updates Workday row when postedAt is null", async () => {
    const { prisma, getCallCount, getLastArgs } = mockPrisma(1);
    const affected = await recoverWorkdayPostedAtOnHashCacheHit(prisma, {
      sourceUrl,
      source: "workday",
      candidate,
    });
    assert.equal(getCallCount(), 1);
    assert.equal(affected, 1);
    assert.deepEqual(getLastArgs()?.where, {
      sourceUrl,
      source: "workday",
      postedAt: null,
    });
    assert.deepEqual(getLastArgs()?.data, {
      postedAt: candidate,
      effectivePostedAt: candidate,
    });
  });

  it("does not update when row already has postedAt (zero rows matched)", async () => {
    const { prisma, getCallCount, getLastArgs } = mockPrisma(0);
    const affected = await recoverWorkdayPostedAtOnHashCacheHit(prisma, {
      sourceUrl,
      source: "workday",
      candidate,
    });
    assert.equal(getCallCount(), 1);
    assert.equal(affected, 0);
    assert.deepEqual((getLastArgs()?.where as { postedAt: null }).postedAt, null);
  });

  it("ignores non-workday rows", async () => {
    const { prisma, getCallCount } = mockPrisma(1);
    const affected = await recoverWorkdayPostedAtOnHashCacheHit(prisma, {
      sourceUrl,
      source: "greenhouse",
      candidate,
    });
    assert.equal(getCallCount(), 0);
    assert.equal(affected, 0);
  });

  it("ignores missing candidate", async () => {
    const { prisma, getCallCount } = mockPrisma(1);
    const affected = await recoverWorkdayPostedAtOnHashCacheHit(prisma, {
      sourceUrl,
      source: "workday",
      candidate: undefined,
    });
    assert.equal(getCallCount(), 0);
    assert.equal(affected, 0);
  });
});
