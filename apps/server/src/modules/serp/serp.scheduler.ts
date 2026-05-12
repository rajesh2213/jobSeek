import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../utils/schedulerShutdown.js";
import {
  getSerpQueue,
  closeSerpQueue,
  RUN_SERP_BATCH_JOB,
  SERP_QUEUE_NAME,
} from "../../queues/serp.queue.js";
import { closeRedisConnection, getIoredis } from "../../queues/job.queue.js";
import {
  getSerpHeartbeatState,
  SERP_HEARTBEAT_KEY,
  touchSerpSchedulerHeartbeat,
  validateSerpHeartbeatAge,
} from "../../services/ingestionObservability.service.js";

const SERP_DAEMON_SINGLETON = Symbol.for("jobseek.serpSchedulerDaemonSingleton");

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * When `SERP_SCHEDULER_INTERVAL_MS` is set (>= 60_000), runs as a long-lived daemon and
 * enqueues on that interval. Writes Redis heartbeat `scheduler:serp:heartbeat` after each successful enqueue.
 *
 * When unset: legacy **one-shot** mode (single enqueue + exit) for cron-style callers.
 */
async function enqueueRun(): Promise<void> {
  const queue = getSerpQueue();
  const jobId = `serp-run-${Date.now()}`;
  await queue.add(
    RUN_SERP_BATCH_JOB,
    {},
    {
      jobId,
    },
  );
}

async function beatHeartbeat(): Promise<void> {
  try {
    const redis = getIoredis();
    await touchSerpSchedulerHeartbeat(redis);
  } catch (err) {
    logger.warn({ event: "serp_scheduler_heartbeat_failed", err }, "serp_scheduler_heartbeat_failed");
  }
}

async function main(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  void SERP_QUEUE_NAME;

  const intervalMs = parsePositiveInt(process.env.SERP_SCHEDULER_INTERVAL_MS, 0);
  const mode = intervalMs >= 60_000 ? "daemon" : "one_shot";

  logger.info(
    {
      event: "serp_scheduler_started",
      mode,
      intervalMs: mode === "daemon" ? intervalMs : null,
      heartbeatKey: SERP_HEARTBEAT_KEY,
    },
    "serp_scheduler_started",
  );

  if (intervalMs >= 60_000) {
    const g = globalThis as typeof globalThis & { [SERP_DAEMON_SINGLETON]?: boolean };
    if (g[SERP_DAEMON_SINGLETON]) {
      logger.error(
        { event: "serp_scheduler_daemon_duplicate_boot", heartbeatKey: SERP_HEARTBEAT_KEY },
        "serp_scheduler_daemon_duplicate_boot",
      );
      process.exitCode = 1;
      return;
    }
    g[SERP_DAEMON_SINGLETON] = true;

    const runTick = async (): Promise<void> => {
      try {
        const redis = getIoredis();
        const hb = await getSerpHeartbeatState(redis);
        const check = validateSerpHeartbeatAge(hb?.ageMs ?? null, intervalMs);
        if (!check.ok && check.reason === "heartbeat_stale_vs_interval") {
          logger.warn(
            {
              event: "serp_scheduler_heartbeat_stale",
              intervalMs,
              ageMs: check.ageMs,
              reason: check.reason,
            },
            "serp_scheduler_heartbeat_stale",
          );
        }

        await enqueueRun();
        await beatHeartbeat();
        logger.info({ event: "serp_scheduler_enqueued", mode: "daemon" }, "serp_scheduler_enqueued");
      } catch (err) {
        logger.error({ event: "serp_scheduler_enqueue_failed", err }, "serp_scheduler_enqueue_failed");
      }
    };

    await runTick();
    const interval = setInterval(() => {
      void runTick();
    }, intervalMs);

    registerSchedulerShutdown({
      intervalIds: [interval],
      closeQueues: [closeSerpQueue],
    });
    return;
  }

  try {
    await enqueueRun();
    await beatHeartbeat();
    logger.info({ event: "serp_scheduler_enqueued_once" }, "serp_scheduler_enqueued_once");
  } catch (err) {
    logger.error({ event: "serp_scheduler_enqueue_failed", err }, "serp_scheduler_enqueue_failed");
    process.exitCode = 1;
  } finally {
    await closeSerpQueue();
    await closeRedisConnection();
  }

  process.exit(process.exitCode ?? 0);
}

void main().catch((err) => {
  logger.error({ event: "serp_scheduler_boot_failed", err }, "serp_scheduler_boot_failed");
  process.exitCode = 1;
});
