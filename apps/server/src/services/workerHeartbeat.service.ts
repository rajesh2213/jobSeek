import type { Redis } from "ioredis";
import { getIoredis } from "../queues/job.queue.js";
import { logger } from "../utils/logger.js";

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_TTL_SEC = 3600;

export type WorkerHealthStatus = "healthy" | "degraded" | "unhealthy" | "missing";

export type WorkerHeartbeatRow = {
  name: string;
  key: string;
  lastBeatIso: string | null;
  ageMs: number | null;
  status: WorkerHealthStatus;
};

function heartbeatKey(workerName: string): string {
  return `worker:${workerName}:heartbeat`;
}

export function evaluateWorkerHeartbeatAge(ageMs: number | null): WorkerHealthStatus {
  if (ageMs == null) return "missing";
  if (ageMs <= 5 * 60_000) return "healthy";
  if (ageMs <= 15 * 60_000) return "degraded";
  return "unhealthy";
}

/** Writes `worker:<name>:heartbeat` (ISO timestamp) every 60s. Observability only. */
export function startWorkerHeartbeat(workerName: string, redis?: Redis): () => void {
  const client = redis ?? getIoredis();

  const beat = (): void => {
    void client
      .set(heartbeatKey(workerName), new Date().toISOString(), "EX", HEARTBEAT_TTL_SEC)
      .catch((err) => {
        logger.warn(
          { event: "worker_heartbeat_write_failed", workerName, err },
          "worker_heartbeat_write_failed",
        );
      });
  };

  beat();
  const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  interval.unref?.();

  return () => clearInterval(interval);
}

/** Known ingestion / maintenance workers probed by internal metrics. */
export const MONITORED_WORKER_NAMES = [
  "job-processing",
  "ingest-ats-endpoint",
  "company-discovery",
  "enrich-company",
  "discover-ats-endpoints",
  "serp-ingestion",
  "job-purge",
  "job-status-reconcile",
  "company-score",
  "openclaw",
] as const;

export async function readWorkerHeartbeats(
  redis: Redis,
  workerNames: readonly string[] = MONITORED_WORKER_NAMES,
): Promise<WorkerHeartbeatRow[]> {
  const rows: WorkerHeartbeatRow[] = [];
  for (const name of workerNames) {
    const key = heartbeatKey(name);
    let lastBeatIso: string | null = null;
    let ageMs: number | null = null;
    try {
      const raw = await redis.get(key);
      if (raw) {
        const t = Date.parse(raw);
        if (Number.isFinite(t)) {
          lastBeatIso = new Date(t).toISOString();
          ageMs = Math.max(0, Date.now() - t);
        }
      }
    } catch {
      /* omit row details */
    }
    rows.push({
      name,
      key,
      lastBeatIso,
      ageMs,
      status: evaluateWorkerHeartbeatAge(ageMs),
    });
  }
  return rows;
}
