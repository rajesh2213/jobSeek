/**
 * Blocker 4 — legacy queue transition validation (isolated test queue).
 *
 * Proves coexistence of legacy `sched-ingest-{id}-{ts}-{i}` jobs with new `ingest-{id}`
 * stable jobIds, and that cleanup dedupes by endpointId (not jobId).
 *
 * Run:
 *   cd apps/server && ATS_LEGACY_TRANSITION_TEST=1 npx tsx --test tests/integration/atsEndpointLegacyTransition.integration.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Queue, type Job } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { atsEndpointJobId, enqueueAtsEndpointIngest } from "../../src/queues/atsEndpointEnqueue.js";
import { INGEST_ATS_ENDPOINT_JOB } from "../../src/queues/ats-endpoint.queue.js";
import { getRedisConnection } from "../../src/queues/job.queue.js";

loadRootEnv();

const enabled =
  process.env.ATS_LEGACY_TRANSITION_TEST === "1" && Boolean(process.env.REDIS_URL?.trim());

function endpointIdFromJob(job: Job): string | null {
  const eid = (job.data as { endpointId?: string })?.endpointId;
  return eid?.trim() ? eid : null;
}

function pickKeeper(jobs: Job[]): Job {
  return jobs.reduce((best, job) => {
    const bestPriority = best.opts.priority ?? 0;
    const jobPriority = job.opts.priority ?? 0;
    if (jobPriority > bestPriority) return job;
    if (jobPriority < bestPriority) return best;
    const bestTs = best.timestamp ?? 0;
    const jobTs = job.timestamp ?? 0;
    return jobTs < bestTs ? job : best;
  });
}

async function simulateCleanup(queue: Queue): Promise<{ removed: number; waitingAfter: number }> {
  const waiting = await queue.getWaitingCount();
  const jobs = await queue.getJobs(["waiting"], 0, waiting - 1, true);
  const byEndpoint = new Map<string, Job[]>();
  for (const job of jobs) {
    const endpointId = endpointIdFromJob(job);
    if (!endpointId) continue;
    const group = byEndpoint.get(endpointId) ?? [];
    group.push(job);
    byEndpoint.set(endpointId, group);
  }

  let removed = 0;
  for (const [, group] of byEndpoint) {
    if (group.length <= 1) continue;
    const keeper = pickKeeper(group);
    for (const job of group) {
      if (job.id === keeper.id) continue;
      await job.remove();
      removed++;
    }
  }
  return { removed, waitingAfter: await queue.getWaitingCount() };
}

const runDescribe = enabled ? describe : describe.skip;

runDescribe("ATS endpoint legacy → stable jobId transition", () => {
  const endpointId = "ep-legacy-transition-test";
  const legacyJobId = `sched-ingest-${endpointId}-1710000000000-0`;
  const stableJobId = atsEndpointJobId(endpointId);
  let queue: Queue;

  before(async () => {
    queue = new Queue(`test-ats-legacy-transition-${Date.now()}`, {
      connection: getRedisConnection(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: false },
    });
  });

  after(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("legacy and stable waiting jobs coexist for the same endpoint", async () => {
    await queue.add(INGEST_ATS_ENDPOINT_JOB, { endpointId }, { jobId: legacyJobId });
    const stableResult = await enqueueAtsEndpointIngest(queue, endpointId);

    assert.equal(stableResult.action, "enqueued");
    assert.notEqual(legacyJobId, stableJobId);

    const waiting = await queue.getWaitingCount();
    assert.equal(waiting, 2, "both legacy and stable jobs should be waiting");

    const jobs = await queue.getJobs(["waiting"], 0, 9, true);
    const ids = new Set(jobs.map((j) => j.id));
    assert.ok(ids.has(legacyJobId));
    assert.ok(ids.has(stableJobId));
  });

  it("cleanup keeps one job per endpointId across legacy and stable jobIds", async () => {
    const { removed, waitingAfter } = await simulateCleanup(queue);
    assert.equal(removed, 1);
    assert.equal(waitingAfter, 1);

    const remaining = await queue.getJobs(["waiting"], 0, 9, true);
    assert.equal(remaining.length, 1);
    assert.equal(endpointIdFromJob(remaining[0]!), endpointId);

    const legacyStillWaiting = remaining.some((j) => j.id === legacyJobId);
    const stableStillWaiting = remaining.some((j) => j.id === stableJobId);
    assert.ok(
      legacyStillWaiting || stableStillWaiting,
      "exactly one of legacy or stable should remain",
    );
    assert.equal(
      legacyStillWaiting && stableStillWaiting,
      false,
      "endpoint must not have both legacy and stable waiting jobs after cleanup",
    );
  });
});
