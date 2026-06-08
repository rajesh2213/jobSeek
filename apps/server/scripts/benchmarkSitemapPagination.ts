/**
 * Benchmark OFFSET listing vs cursor sitemap reads at equivalent depths.
 * Usage: npm run benchmark:sitemap-pagination -w @jobseek/server
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import {
  sqlForCanonicalListingIds,
  sqlForCanonicalSitemapRows,
} from "../src/modules/job/job.repository.js";
import type { SitemapJobCursor } from "../src/modules/job/sitemapCursor.js";

loadRootEnv();

const DEPTHS = [
  { label: "Page 1", offset: 0 },
  { label: "Page 50", offset: 4900 },
  { label: "Page 100", offset: 9900 },
  { label: "Page 200", offset: 19900 },
];

async function timeOffset(prisma: PrismaClient, offset: number): Promise<number> {
  const sql = sqlForCanonicalListingIds({
    sort: "latest",
    limit: 100,
    offset,
  });
  const t0 = performance.now();
  await prisma.$queryRaw(sql);
  return Math.round(performance.now() - t0);
}

async function timeCursorToOffset(prisma: PrismaClient, targetOffset: number): Promise<number> {
  let cursor: SitemapJobCursor | null = null;
  let walked = 0;
  const t0 = performance.now();
  while (walked < targetOffset) {
    const limit = Math.min(500, targetOffset - walked);
    const sql = sqlForCanonicalSitemapRows({ limit, cursor });
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        postedAt: Date | null;
        createdAt: Date;
        listingFreshnessAt: Date;
      }>
    >(sql);
    if (rows.length === 0) break;
    walked += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = {
      postedAt: last.postedAt,
      listingFreshnessAt: last.listingFreshnessAt,
      createdAt: last.createdAt,
      id: last.id,
    };
    if (rows.length < limit) break;
  }
  const sql = sqlForCanonicalSitemapRows({ limit: 100, cursor });
  await prisma.$queryRaw(sql);
  return Math.round(performance.now() - t0);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL required");
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  console.log("=== Sitemap pagination benchmark (DB) ===\n");
  console.log("| Depth | OFFSET id-query (ms) | Cursor walk+page (ms) |");
  console.log("|-------|----------------------|------------------------|");

  for (const d of DEPTHS) {
    let offsetMs: string;
    let cursorMs: string;
    try {
      offsetMs = String(await timeOffset(prisma, d.offset));
    } catch {
      offsetMs = "error";
    }
    try {
      cursorMs = String(await timeCursorToOffset(prisma, d.offset));
    } catch {
      cursorMs = "error";
    }
    console.log(`| ${d.label} | ${offsetMs} | ${cursorMs} |`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
