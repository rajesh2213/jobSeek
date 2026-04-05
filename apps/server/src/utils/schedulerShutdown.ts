import { logger } from "./logger.js";
import { closeRedisConnection } from "../queues/job.queue.js";

/**
 * Long-running schedulers: clear intervals, close BullMQ queues, optional Prisma, then Redis.
 */
export function registerSchedulerShutdown(opts: {
  intervalIds: NodeJS.Timeout[];
  closeQueues: Array<() => Promise<void>>;
  prismaDisconnect?: () => Promise<void>;
}): void {
  let exiting = false;

  const shutdown = async (signal: string) => {
    if (exiting) return;
    exiting = true;
    logger.info({ signal, event: "scheduler_shutdown_start" }, "scheduler_shutdown_start");
    for (const id of opts.intervalIds) {
      clearInterval(id);
    }
    try {
      for (const close of opts.closeQueues) {
        await close();
      }
      if (opts.prismaDisconnect) {
        await opts.prismaDisconnect();
      }
      await closeRedisConnection();
    } catch (err) {
      logger.error(
        { err, signal, event: "scheduler_shutdown_error" },
        "scheduler_shutdown_error",
      );
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
