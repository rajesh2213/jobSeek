import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../env/loadEnv.js";

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

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
