import { PrismaClient } from "../../prisma/generatedClient.js";
import { loadRootEnv } from "../env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { registerPrismaReadInstrumentation } from "../../utils/prismaInstrumentation.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

loadRootEnv();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

/** Outer middleware: read egress + slow-query timing applies to the full round-trip. */
registerPrismaReadInstrumentation(prisma);

const prismaSlowQueryMs = Number(process.env.PRISMA_SLOW_QUERY_MS ?? "0");
if (prismaSlowQueryMs > 0) {
  prisma.$use(async (params, next) => {
    const t0 = Date.now();
    const result = await next(params);
    const ms = Date.now() - t0;
    if (ms >= prismaSlowQueryMs) {
      logger.warn(
        {
          event: "prisma_slow_query",
          durationMs: ms,
          model: params.model,
          action: params.action,
        },
        "prisma_slow_query",
      );
    }
    return result;
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
