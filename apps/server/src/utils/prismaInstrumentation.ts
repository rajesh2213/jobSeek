import type { Prisma, PrismaClient } from "../prisma/generatedClient.js";
import { logger } from "./logger.js";
import { trackEgress } from "./egressTracker.js";

const READ_ACTIONS = new Set<string>([
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
  "queryRaw",
]);

function estimateRowCount(result: unknown): number {
  if (result == null) return 0;
  if (Array.isArray(result)) return result.length;
  if (typeof result === "bigint" || typeof result === "number") return 1;
  if (typeof result === "object") return 1;
  return 1;
}

function defaultAvgRowBytes(model: string | undefined, action: string): number {
  if (action === "count" || action === "aggregate" || action === "groupBy") return 200;
  if (model === "Job") return 1200;
  if (model === "Company" || model === "AtsEndpoint" || model === "SerpResult") return 500;
  return 800;
}

/**
 * Global Prisma read instrumentation: contributes to `egress_hourly` via trackEgress.
 * Emits sparse `prisma_read_egress` info logs when volume or latency is high (reduce noise).
 */
export function registerPrismaReadInstrumentation(client: PrismaClient): void {
  const logAll = process.env.PRISMA_READ_LOG === "1";
  const skipRaw = process.env.PRISMA_LOG_RAW_EGRESS === "0";

  client.$use(async (params: Prisma.MiddlewareParams, next: (p: Prisma.MiddlewareParams) => Promise<unknown>) => {
    if (!READ_ACTIONS.has(params.action)) return next(params);
    if (params.action === "queryRaw" && skipRaw) return next(params);

    const t0 = Date.now();
    const result = await next(params);
    const durationMs = Date.now() - t0;
    const model = (params.model as string) ?? "raw";
    const n = estimateRowCount(result);
    if (n === 0) return result;

    const avg = defaultAvgRowBytes(model, params.action);
    const estimatedKB = (n * avg) / 1024;
    trackEgress(estimatedKB, { source: "prisma" });

    const loud = logAll || n >= 200 || durationMs >= 2000;
    if (loud) {
      logger.info(
        {
          event: "prisma_read_egress",
          model,
          action: params.action,
          rowCount: n,
          durationMs,
          estimatedKB: Number(estimatedKB.toFixed(2)),
        },
        "prisma_read_egress",
      );
    }

    return result;
  });
}
