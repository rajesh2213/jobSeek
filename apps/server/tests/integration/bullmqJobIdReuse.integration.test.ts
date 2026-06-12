/**
 * Blocker 1 — verify BullMQ stable jobId reuse after completion + removeOnComplete.
 *
 * Enable with BULLMQ_JOBID_REUSE_TEST=1 and REDIS_URL (uses an isolated test queue).
 *
 * Run:
 *   cd apps/server && BULLMQ_JOBID_REUSE_TEST=1 npx tsx --test tests/integration/bullmqJobIdReuse.integration.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import Redis from "ioredis";
import { Queue, QueueEvents, Worker, type ConnectionOptions } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";

loadRootEnv();

const enabled =
  process.env.BULLMQ_JOBID_REUSE_TEST === "1" && Boolean(process.env.REDIS_URL?.trim());

function bullmqVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: { bullmq?: string };
  };
  return pkg.dependencies?.bullmq ?? "unknown";
}

const runDescribe = enabled ? describe : describe.skip;

runDescribe("BullMQ jobId reuse after completion", () => {
  const queueName = `test-bullmq-jobid-reuse-${Date.now()}`;
  const stableJobId = "test-endpoint-123";
  let connection: ConnectionOptions;
  let redis: Redis;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let worker: Worker;
  let firstProcessed = false;
  let secondProcessed = false;

  before(async () => {
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    connection = redis as unknown as ConnectionOptions;
    queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    worker = new Worker(
      queueName,
      async (job) => {
        if (job.id === stableJobId && job.data?.pass === 1) firstProcessed = true;
        if (job.id === stableJobId && job.data?.pass === 2) secondProcessed = true;
        return { ok: true };
      },
      { connection },
    );
  });

  after(async () => {
    await worker.close(true);
    await queueEvents.close();
    await queue.drain(true);
    await queue.close();
    await redis.quit();
  });

  it("reuses the same jobId after successful completion", async () => {
    const version = bullmqVersion();
    assert.match(version, /^[\^~]?\d/, `unexpected bullmq version: ${version}`);

    const first = await queue.add("test-job", { pass: 1 }, { jobId: stableJobId });
    assert.equal(first.id, stableJobId);

    await first.waitUntilFinished(queueEvents);

    const afterFirst = await queue.getJob(stableJobId);
    assert.equal(afterFirst, undefined, "job record should be removed after completion");

    const second = await queue.add("test-job", { pass: 2 }, { jobId: stableJobId });
    assert.equal(second.id, stableJobId, "second add with same jobId must succeed");

    await second.waitUntilFinished(queueEvents);

    assert.equal(firstProcessed, true, "first job must have executed");
    assert.equal(secondProcessed, true, "second job must have executed");

    console.log(
      JSON.stringify({
        bullmqVersion: version,
        queueName,
        stableJobId,
        firstAddSucceeded: true,
        removedAfterComplete: afterFirst === undefined,
        secondAddSucceeded: true,
        firstExecuted: firstProcessed,
        secondExecuted: secondProcessed,
        result: "PASS",
      }),
    );
  });
});
