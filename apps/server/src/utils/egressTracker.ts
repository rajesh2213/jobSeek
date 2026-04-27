import { logger } from "./logger.js";

export type EgressSource = "prisma" | "manual";

const zeros = (): Record<EgressSource, number> => ({ prisma: 0, manual: 0 });

/** Per-process only — each worker/API process maintains its own counters; sum `egress_hourly` in your log platform. */
let totalKBBySource = zeros();
let hourInterval: ReturnType<typeof setInterval> | null = null;

function processLabel(): string {
  const w = process.env.WORKER_NAME?.trim();
  if (w) return w;
  return String(process.pid);
}

/**
 * Add estimated read volume. Single-process, best-effort.
 * `source: "prisma"` — Prisma read middleware (DB path).
 * `source: "manual"` — in-memory / named `logQueryMetrics` (default).
 */
export function trackEgress(estimatedKB: number, opts?: { source?: EgressSource }): void {
  if (!Number.isFinite(estimatedKB) || estimatedKB <= 0) return;
  const source: EgressSource = opts?.source ?? "manual";
  totalKBBySource[source] += estimatedKB;
}

function roundKb(n: number): number {
  return Number(n.toFixed(2));
}

function roundMb(n: number): number {
  return Number((n / 1024).toFixed(4));
}

function flushHourly(): void {
  const p = totalKBBySource.prisma;
  const m = totalKBBySource.manual;
  totalKBBySource = zeros();
  const total = p + m;
  if (total <= 0) return;

  const base = { totalKB: roundKb(total), totalMB: roundMb(total) };
  logger.info(
    {
      event: "egress_hourly",
      process: processLabel(),
      ...base,
      egressBySource: {
        prisma: { totalKB: roundKb(p), totalMB: roundMb(p) },
        manual: { totalKB: roundKb(m), totalMB: roundMb(m) },
      },
    },
    "egress_hourly",
  );
}

if (process.env.EGRESS_HOURLY_LOG !== "0") {
  const hourMs = 60 * 60 * 1000;
  hourInterval = setInterval(flushHourly, hourMs);
  hourInterval.unref?.();
  process.on("beforeExit", () => {
    if (hourInterval) clearInterval(hourInterval);
  });
}

export function getEgressTotalKBForTest(): number {
  return totalKBBySource.prisma + totalKBBySource.manual;
}

export function getEgressTotalsBySourceForTest(): Record<EgressSource, number> {
  return { ...totalKBBySource };
}
