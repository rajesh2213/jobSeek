import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireWorkdayRepairWorkerLock,
  releaseWorkdayRepairWorkerLock,
  withWorkdayJobRepairLock,
} from "../../../src/utils/workdayRepairLock.js";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, ...args: string[]) {
      const nx = args.includes("NX");
      if (nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async del(key: string) {
      store.delete(key);
    },
    store,
  };
}

describe("workdayRepairLock", () => {
  it("denies second worker lock", async () => {
    const redis = fakeRedis() as never;
    const first = await acquireWorkdayRepairWorkerLock(redis, "worker-a");
    const second = await acquireWorkdayRepairWorkerLock(redis, "worker-b");
    assert.equal(first, true);
    assert.equal(second, false);
    await releaseWorkdayRepairWorkerLock(redis);
    const third = await acquireWorkdayRepairWorkerLock(redis, "worker-c");
    assert.equal(third, true);
  });

  it("returns locked when per-job lock is busy", async () => {
    const redis = fakeRedis() as never;
    await redis.set("workday:repair:job:job-1", "1", "EX", "120", "NX");
    const result = await withWorkdayJobRepairLock(redis, "job-1", async () => "done");
    assert.deepEqual(result, { locked: true });
  });

  it("runs fn when per-job lock acquired", async () => {
    const redis = fakeRedis() as never;
    const result = await withWorkdayJobRepairLock(redis, "job-2", async () => ({
      ok: true,
      jobId: "job-2",
      wasPublishable: false,
      isPublishable: true,
    }));
    assert.equal((result as { ok: boolean }).ok, true);
  });
});
