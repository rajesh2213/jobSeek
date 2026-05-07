import { logger } from "./logger.js";

function enabled(): boolean {
  return process.env.DEBUG_DB_PAYLOADS === "1";
}

export function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

export function logUpdateReturnClassification(input: {
  location: string;
  classification: "FULL_RETURN_REQUIRED" | "PARTIAL_RETURN_OK" | "NO_RETURN_NEEDED";
  selectedFields?: string[];
}): void {
  if (!enabled()) return;
  logger.info(
    {
      event: "UPDATE_RETURN_CLASSIFICATION",
      location: input.location,
      classification: input.classification,
      selectedFields: input.selectedFields ?? [],
    },
    "UPDATE_RETURN_CLASSIFICATION",
  );
}

export function logUpdateReturnBytesEstimate(input: {
  location: string;
  estimatedBytes: number;
  rows: number;
}): void {
  if (!enabled()) return;
  logger.info(
    {
      event: "UPDATE_RETURN_BYTES_ESTIMATE",
      location: input.location,
      estimatedBytes: input.estimatedBytes,
      estimatedKB: Number((input.estimatedBytes / 1024).toFixed(2)),
      rows: input.rows,
    },
    "UPDATE_RETURN_BYTES_ESTIMATE",
  );
}

export function logUpdateReturnOptimized(input: {
  location: string;
  strategy: "updateMany" | "narrow_select";
  note?: string;
}): void {
  if (!enabled()) return;
  logger.info(
    {
      event: "UPDATE_RETURN_OPTIMIZED",
      location: input.location,
      strategy: input.strategy,
      note: input.note ?? null,
    },
    "UPDATE_RETURN_OPTIMIZED",
  );
}
