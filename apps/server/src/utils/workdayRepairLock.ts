import type { Redis } from "ioredis";
import { logger } from "./logger.js";

const WORKER_LOCK_KEY = "workday:repair:worker-lock";
const JOB_LOCK_PREFIX = "workday:repair:job:";
const DEFAULT_JOB_LOCK_SEC = 120;
const DEFAULT_WORKER_LOCK_SEC = 3600;

export async function acquireWorkdayRepairWorkerLock(
  redis: Redis,
  owner: string,
  ttlSec = DEFAULT_WORKER_LOCK_SEC,
): Promise<boolean> {
  const ok = await redis.set(WORKER_LOCK_KEY, owner, "EX", ttlSec, "NX");
  return ok === "OK";
}

export async function releaseWorkdayRepairWorkerLock(redis: Redis): Promise<void> {
  await redis.del(WORKER_LOCK_KEY);
}

export async function withWorkdayJobRepairLock<T>(
  redis: Redis,
  jobId: string,
  fn: () => Promise<T>,
  ttlSec = DEFAULT_JOB_LOCK_SEC,
): Promise<T | { locked: true }> {
  const key = `${JOB_LOCK_PREFIX}${jobId}`;
  const ok = await redis.set(key, "1", "EX", ttlSec, "NX");
  if (ok !== "OK") {
    logger.info(
      { event: "workday_repair_job_lock_busy", jobId },
      "workday_repair_job_lock_busy",
    );
    return { locked: true };
  }
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}
