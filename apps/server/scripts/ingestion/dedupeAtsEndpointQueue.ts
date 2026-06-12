/**
 * One-off queue cleanup: remove duplicate waiting jobs per endpoint.
 * Dry-run by default — pass --apply to remove duplicates.
 *
 * Run:
 *   npx tsx scripts/ingestion/dedupeAtsEndpointQueue.ts
 *   npx tsx scripts/ingestion/dedupeAtsEndpointQueue.ts --apply
 */
import { Queue, type Job } from "bullmq";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { getRedisConnection } from "../../src/queues/job.queue.js";
import { INGEST_ATS_ENDPOINT_QUEUE_NAME } from "../../src/queues/ats-endpoint.queue.js";

type EndpointJobGroup = {
  endpointId: string;
  jobs: Job[];
};

function endpointIdFromJob(job: Job): string | null {
  const eid = (job.data as { endpointId?: string })?.endpointId;
  return eid?.trim() ? eid : null;
}

/** Higher BullMQ priority wins; tie-break older timestamp (FIFO). */
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

async function loadWaitingJobs(queue: Queue): Promise<Job[]> {
  const waiting = await queue.getWaitingCount();
  const pageSize = 500;
  const jobs: Job[] = [];
  let start = 0;
  while (start < waiting) {
    const end = Math.min(start + pageSize - 1, waiting - 1);
    const page = await queue.getJobs(["waiting"], start, end, true);
    if (page.length === 0) break;
    jobs.push(...page);
    start += pageSize;
  }
  return jobs;
}

async function main(): Promise<void> {
  loadRootEnv();
  const apply = process.argv.includes("--apply");

  const queue = new Queue(INGEST_ATS_ENDPOINT_QUEUE_NAME, { connection: getRedisConnection() });
  try {
    const [waiting, active, delayed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
    ]);

    const waitingJobs = await loadWaitingJobs(queue);
    const byEndpoint = new Map<string, Job[]>();
    let jobsWithoutEndpoint = 0;

    for (const job of waitingJobs) {
      const endpointId = endpointIdFromJob(job);
      if (!endpointId) {
        jobsWithoutEndpoint++;
        continue;
      }
      const group = byEndpoint.get(endpointId) ?? [];
      group.push(job);
      byEndpoint.set(endpointId, group);
    }

    const groups: EndpointJobGroup[] = [...byEndpoint.entries()].map(([endpointId, jobs]) => ({
      endpointId,
      jobs,
    }));

    const duplicatesRemovable = groups.reduce((sum, g) => sum + Math.max(0, g.jobs.length - 1), 0);
    const uniqueEndpoints = groups.length;
    const estimatedQueueSizeAfter = uniqueEndpoints + active + delayed + jobsWithoutEndpoint;

    const report = {
      mode: apply ? "apply" : "dry-run",
      waiting,
      active,
      delayed,
      failed,
      uniqueEndpoints,
      jobsWithoutEndpoint,
      duplicatesRemovable,
      estimatedQueueSizeAfter,
      duplicateRatio: uniqueEndpoints > 0 ? Number((waiting / uniqueEndpoints).toFixed(2)) : 0,
    };

    if (apply) {
      let removed = 0;
      for (const group of groups) {
        if (group.jobs.length <= 1) continue;
        const keeper = pickKeeper(group.jobs);
        for (const job of group.jobs) {
          if (job.id === keeper.id) continue;
          await job.remove();
          removed++;
        }
      }
      const afterWaiting = await queue.getWaitingCount();
      console.log(JSON.stringify({ ...report, removed, waitingAfter: afterWaiting }, null, 2));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    await queue.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
