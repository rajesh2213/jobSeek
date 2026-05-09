/**
 * CLI: print pg_stat_activity snapshot (same queries as GET /internal/db/pg-activity).
 *
 *   npm run diag:pg-activity -w @jobseek/server
 *
 * Requires DATABASE_URL. Uses repo-root `.env` via loadRootEnv.
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { buildDbActivitySnapshot } from "../src/services/dbActivitySnapshot.service.js";

loadRootEnv();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const snapshot = await buildDbActivitySnapshot(prisma);
    console.log(JSON.stringify({ ok: true, snapshot }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
