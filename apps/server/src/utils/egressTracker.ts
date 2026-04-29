import { logger } from "./logger.js";

export type EgressSource = "prisma" | "manual";
export type CallerType =
  | "internal_ssr"
  | "local_internal"
  | "external_node_bot"
  | "browser"
  | "unknown";

const zeros = (): Record<EgressSource, number> => ({ prisma: 0, manual: 0 });
const callerZeros = (): Record<CallerType, number> => ({
  internal_ssr: 0,
  local_internal: 0,
  external_node_bot: 0,
  browser: 0,
  unknown: 0,
});

/** Per-process only — each worker/API process maintains its own counters; sum `egress_hourly` in your log platform. */
let totalKBBySource = zeros();
let totalKBByCallerType = callerZeros();
let hourInterval: ReturnType<typeof setInterval> | null = null;
const requestCallerType = new Map<string, CallerType>();
const MAX_REQUEST_CALLER_CACHE = 50_000;

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

export function registerRequestCallerType(requestId: string, callerType: CallerType): void {
  if (!requestId) return;
  requestCallerType.set(requestId, callerType);
  if (requestCallerType.size > MAX_REQUEST_CALLER_CACHE) {
    const overBy = requestCallerType.size - MAX_REQUEST_CALLER_CACHE;
    let i = 0;
    for (const key of requestCallerType.keys()) {
      requestCallerType.delete(key);
      i += 1;
      if (i >= overBy) break;
    }
  }
}

export function clearRequestCallerType(requestId: string): void {
  if (!requestId) return;
  requestCallerType.delete(requestId);
}

export function trackEgressWithCallerType(
  estimatedKB: number,
  opts?: {
    source?: EgressSource;
    requestId?: string;
    callerType?: CallerType;
  },
): void {
  if (!Number.isFinite(estimatedKB) || estimatedKB <= 0) return;
  const source: EgressSource = opts?.source ?? "manual";
  const resolvedCallerType =
    opts?.callerType ??
    (opts?.requestId ? requestCallerType.get(opts.requestId) : undefined) ??
    "unknown";
  totalKBBySource[source] += estimatedKB;
  totalKBByCallerType[resolvedCallerType] += estimatedKB;
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
  const byCaller = totalKBByCallerType;
  totalKBByCallerType = callerZeros();
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
      egressByCallerType: {
        internal_ssr: {
          totalKB: roundKb(byCaller.internal_ssr),
          totalMB: roundMb(byCaller.internal_ssr),
        },
        local_internal: {
          totalKB: roundKb(byCaller.local_internal),
          totalMB: roundMb(byCaller.local_internal),
        },
        external_node_bot: {
          totalKB: roundKb(byCaller.external_node_bot),
          totalMB: roundMb(byCaller.external_node_bot),
        },
        browser: {
          totalKB: roundKb(byCaller.browser),
          totalMB: roundMb(byCaller.browser),
        },
        unknown: {
          totalKB: roundKb(byCaller.unknown),
          totalMB: roundMb(byCaller.unknown),
        },
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
