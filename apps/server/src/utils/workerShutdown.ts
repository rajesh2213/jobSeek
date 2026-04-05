import type { Worker } from "bullmq";
import { logger } from "./logger.js";
import { closeRedisConnection } from "../queues/job.queue.js";

/**
 * BullMQ workers: finish in-flight jobs (`worker.close()`), close queue instances, Prisma, Redis.
 */
export function registerWorkerShutdown(opts: {
  worker: Worker;
  closeQueues: Array<() => Promise<void>>;
  prismaDisconnect?: () => Promise<void>;
}): void {
  let exiting = false;

  const shutdown = async (signal: string) => {
    if (exiting) return;
    exiting = true;
    logger.info({ signal, event: "worker_shutdown_start" }, "worker_shutdown_start");
    try {
      await opts.worker.close();
      for (const close of opts.closeQueues) {
        await close();
      }
      if (opts.prismaDisconnect) {
        await opts.prismaDisconnect();
      }
      await closeRedisConnection();
    } catch (err) {
      logger.error(
        { err, signal, event: "worker_shutdown_error" },
        "worker_shutdown_error",
      );
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
