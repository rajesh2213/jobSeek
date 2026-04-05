import { prisma } from "../infrastructure/db/prisma.js";
import { logger } from "../utils/logger.js";
import { Prisma } from "@prisma/client";

async function main(): Promise<void> {
  try {
    const count = await prisma.atsEndpoint.count();
    logger.info(
      { event: "ats_endpoint_verify_ok", rowCount: count },
      `AtsEndpoint table exists. Row count: ${count}`,
    );
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      logger.error(
        { event: "ats_endpoint_verify_missing_table", err },
        "AtsEndpoint table missing — run prisma migrate",
      );
      process.exitCode = 1;
      return;
    }
    logger.error({ event: "ats_endpoint_verify_failed", err }, "ats_endpoint_verify_failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
