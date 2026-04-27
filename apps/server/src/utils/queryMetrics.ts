import { logger } from "./logger.js";
import { trackEgress } from "./egressTracker.js";

const DEFAULT_WARN_ROW_THRESHOLD = 100;
const DEFAULT_WARN_KB_THRESHOLD = 200;

export type LogQueryMetricsOptions = {
  /** When false, does not add to `egress_hourly` (use for named metrics that duplicate Prisma middleware). */
  countTowardEgress?: boolean;
};

export type QueryMetricsResult = {
  readRows: number;
  estimatedKB: number;
};

export function logQueryMetrics<T>(
  name: string,
  rows: T[],
  avgRowBytes = 1000,
  updatedRowsOrOptions?: number | LogQueryMetricsOptions,
  options?: LogQueryMetricsOptions,
): QueryMetricsResult {
  let updatedRows: number | undefined;
  let countTowardEgress = true;
  if (typeof updatedRowsOrOptions === "number") {
    updatedRows = updatedRowsOrOptions;
    if (options?.countTowardEgress === false) countTowardEgress = false;
  } else if (updatedRowsOrOptions && typeof updatedRowsOrOptions === "object") {
    if (updatedRowsOrOptions.countTowardEgress === false) countTowardEgress = false;
  }

  const rowCount = rows.length;
  const estimatedKB = (rowCount * avgRowBytes) / 1024;
  logger.info(
    {
      event: "query_metrics",
      query: name,
      rowsFetched: rowCount,
      avgRowBytes,
      estimatedKB: Number(estimatedKB.toFixed(2)),
      readRows: rowCount,
      ...(typeof updatedRows === "number" ? { updatedRows } : {}),
    },
    "query_metrics",
  );

  if (countTowardEgress) {
    trackEgress(estimatedKB, { source: "manual" });
  }

  if (rowCount > DEFAULT_WARN_ROW_THRESHOLD || estimatedKB > DEFAULT_WARN_KB_THRESHOLD) {
    logger.warn(
      {
        event: "query_metrics_warn",
        query: name,
        rowsFetched: rowCount,
        estimatedKB: Number(estimatedKB.toFixed(2)),
        warnRowThreshold: DEFAULT_WARN_ROW_THRESHOLD,
        warnKbThreshold: DEFAULT_WARN_KB_THRESHOLD,
      },
      "query_metrics_warn",
    );
  }
  return { readRows: rowCount, estimatedKB };
}

export function logEfficiencyMetrics(input: {
  name: string;
  readRows: number;
  updatedRows: number;
  skippedRows: number;
}): number {
  const efficiency = input.readRows > 0 ? input.updatedRows / input.readRows : 1;
  logger.info(
    {
      event: "efficiency_metrics",
      name: input.name,
      readRows: input.readRows,
      updatedRows: input.updatedRows,
      skippedRows: input.skippedRows,
      efficiency: Number(efficiency.toFixed(4)),
    },
    "efficiency_metrics",
  );
  if (efficiency < 0.1) {
    logger.warn(
      {
        event: "efficiency_metrics_warn",
        name: input.name,
        readRows: input.readRows,
        updatedRows: input.updatedRows,
        skippedRows: input.skippedRows,
        efficiency: Number(efficiency.toFixed(4)),
        warnThreshold: 0.1,
      },
      "efficiency_metrics_warn",
    );
  }
  return efficiency;
}

export function logCacheHitMetrics(input: {
  name: string;
  hits: number;
  misses: number;
}): void {
  const total = input.hits + input.misses;
  const hitRate = total > 0 ? input.hits / total : 0;
  logger.info(
    {
      event: "cache_hit_metrics",
      name: input.name,
      hits: input.hits,
      misses: input.misses,
      total,
      hitRate: Number(hitRate.toFixed(4)),
    },
    "cache_hit_metrics",
  );
}

export function assertRequiredSelect(
  model: "Job" | "SerpResult" | "AtsEndpoint" | "Company",
  operation: string,
  select: unknown,
): void {
  if (!select || typeof select !== "object" || Object.keys(select as Record<string, unknown>).length === 0) {
    logger.error(
      { event: "required_select_missing", model, operation },
      "required_select_missing",
    );
  }
}

