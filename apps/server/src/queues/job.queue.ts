import { Redis as RedisClient } from "ioredis";
import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export const JOB_QUEUE_NAME = "job-processing";

export type JobQueueName = typeof JOB_QUEUE_NAME;

export interface JobQueue {
  add<T>(name: string, data: T, opts?: unknown): Promise<unknown>;
}

let queueSingleton: Queue | null = null;
let redisClient: RedisClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** BullMQ connection: underlying ioredis (quit on graceful shutdown). */
export function getRedisConnection(): ConnectionOptions {
  if (redisClient) return redisClient as unknown as ConnectionOptions;
  const redisUrl = requireEnv("REDIS_URL");
  redisClient = new RedisClient(redisUrl, { maxRetriesPerRequest: null });
  return redisClient as unknown as ConnectionOptions;
}

/** Direct ioredis client for key-value (e.g. daily view cap); shares URL with BullMQ. */
export function getIoredis(): RedisClient {
  getRedisConnection();
  if (!redisClient) {
    throw new Error("Redis client not initialized");
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }
  redisClient = null;
}

export async function closeJobQueue(): Promise<void> {
  if (!queueSingleton) return;
  await queueSingleton.close();
  queueSingleton = null;
}

export function getJobQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  queueSingleton = new Queue(JOB_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnFail: false,
    },
  });

  return queueSingleton;
}
