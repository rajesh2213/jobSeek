import { loadRootEnv } from "../../../../infrastructure/env/loadEnv.js";
import { logger } from "../../../../utils/logger.js";
import { assertWorkerProcessEnv } from "../../../../infrastructure/env/validateWorkerEnv.js";
import { registerSchedulerShutdown } from "../../../../utils/schedulerShutdown.js";
import { loadOpenClawEnv, isOpenClawConfiguredForSync } from "./openclaw.env.js";
import {
  getOpenclawQueue,
  closeOpenclawQueue,
  OPENCLAW_SYNC_JOB,
  OPENCLAW_QUEUE_NAME,
} from "../../../../queues/openclaw.queue.js";

let consecutiveFailures = 0;
const MAX_LOG_FAIL_STREAK = 12;

async function tick(): Promise<void> {
  const cfg = loadOpenClawEnv();
  if (!isOpenClawConfiguredForSync(cfg)) {
    logger.info(
      {
        event: "openclaw_scheduler_disabled",
        provider: "openclaw",
        enabled: cfg.enabled,
        syncEnabled: cfg.syncEnabled,
        hasKey: Boolean(cfg.apiKey?.trim()),
      },
      "openclaw_scheduler_disabled",
    );
    return;
  }

  const queue = getOpenclawQueue();
  try {
    await queue.add(
      OPENCLAW_SYNC_JOB,
      { triggeredAt: new Date().toISOString() },
      {
        jobId: `openclaw-sync-${Date.now()}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    consecutiveFailures = 0;
    logger.info(
      { event: "openclaw_scheduler_enqueued", provider: "openclaw", queue: OPENCLAW_QUEUE_NAME },
      "openclaw_scheduler_enqueued",
    );
  } catch (err) {
    consecutiveFailures += 1;
    if (consecutiveFailures <= 3 || consecutiveFailures % MAX_LOG_FAIL_STREAK === 0) {
      logger.warn(
        {
          event: "openclaw_scheduler_enqueue_failed",
          provider: "openclaw",
          streak: consecutiveFailures,
          err,
        },
        "openclaw_scheduler_enqueue_failed",
      );
    }
  }
}

async function main(): Promise<void> {
  loadRootEnv();
  const cfg = loadOpenClawEnv();
  if (!isOpenClawConfiguredForSync(cfg)) {
    logger.info(
      {
        event: "openclaw_scheduler_exit_clean",
        provider: "openclaw",
        reason: "not_configured",
      },
      "openclaw_scheduler_exit_clean",
    );
    return;
  }

  assertWorkerProcessEnv();
  void OPENCLAW_QUEUE_NAME;

  await tick();
  const interval = setInterval(() => {
    void tick();
  }, cfg.syncIntervalMs);

  registerSchedulerShutdown({
    intervalIds: [interval],
    closeQueues: [closeOpenclawQueue],
  });
}

void main().catch((err) => {
  logger.error({ event: "openclaw_scheduler_boot_failed", provider: "openclaw", err }, "openclaw_scheduler_boot_failed");
  process.exitCode = 1;
});
