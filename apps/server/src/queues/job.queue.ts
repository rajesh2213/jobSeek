import { Redis as RedisClient } from "ioredis";
import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

export const JOB_QUEUE_NAME = "job-processing";

export type JobQueueName = typeof JOB_QUEUE_NAME;

export interface JobQueue {
  add<T>(name: string, data: T, opts?: unknown): Promise<unknown>;
}

let queueSingleton: Queue | null = null;
let redisSingleton: ConnectionOptions | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getRedisConnection(): ConnectionOptions {
  if (redisSingleton) return redisSingleton;
  const redisUrl = requireEnv("REDIS_URL");
  redisSingleton = new RedisClient(redisUrl, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
  return redisSingleton;
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

