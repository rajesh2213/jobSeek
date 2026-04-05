import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "../../utils/logger.js";

let endpointIngestionEnabled = true;
let readinessChecked = false;

export function isAtsEndpointIngestionEnabled(): boolean {
  return endpointIngestionEnabled;
}

export function disableAtsEndpointIngestion(reason: string): void {
  endpointIngestionEnabled = false;
  logger.error(
    {
      event: "ats_endpoint_table_missing",
      reason,
    },
    "AtsEndpoint table missing — run prisma migrate",
  );
}

export async function ensureAtsEndpointTableReady(
  prisma: PrismaClient,
  context: string,
): Promise<boolean> {
  if (readinessChecked) return endpointIngestionEnabled;
  readinessChecked = true;

  try {
    await prisma.atsEndpoint.count({ take: 1 });
    endpointIngestionEnabled = true;
    logger.info(
      { event: "ats_endpoint_table_ready", context },
      "ats_endpoint_table_ready",
    );
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      disableAtsEndpointIngestion(context);
      return false;
    }
    logger.warn(
      { event: "ats_endpoint_table_check_failed", context, err },
      "ats_endpoint_table_check_failed",
    );
    return endpointIngestionEnabled;
  }
}
