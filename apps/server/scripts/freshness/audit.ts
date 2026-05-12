/**
 * Freshness data-quality audit (READ-ONLY).
 *
 * Mirrors apps/server/scripts/freshness/audit.sql but runs through Prisma so the
 * operator can produce a structured JSON + Markdown report against the read
 * replica without psql.
 *
 *   cd apps/server && DATABASE_URL=... npx tsx scripts/freshness/audit.ts
 *   cd apps/server && DATABASE_URL=... npx tsx scripts/freshness/audit.ts --json > ../../docs/freshness-overhaul/02-data-quality.json
 *
 * This script ONLY reads. No UPDATE / INSERT / DELETE / DDL.
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";

loadRootEnv();

type CountRow = Record<string, string | number | null>;

function parseArgs(argv: string[]) {
  return {
    asJson: argv.includes("--json"),
  };
}

function numify<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out as T;
}

async function main(): Promise<void> {
  const { asJson } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const startedAt = new Date().toISOString();

  try {
    const overall = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT("postedAt")::bigint AS with_posted,
        COUNT(*) FILTER (WHERE "postedAt" IS NULL)::bigint AS without_posted,
        ROUND(100.0 * COUNT("postedAt") / NULLIF(COUNT(*), 0), 2)::float8 AS pct_with_posted
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "isActive" = true
        AND ("status" = 'ready' OR "status" IS NULL)
    `);

    const proxy = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE "postedAt" IS NULL)::bigint AS posted_null,
        COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
        )::bigint AS posted_eq_created_proxy,
        COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
        )::bigint AS posted_real,
        ROUND(100.0 * COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
        ) / NULLIF(COUNT(*), 0), 2)::float8 AS pct_real
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
    `);

    const bySource = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        source,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE "postedAt" IS NULL)::bigint AS posted_null,
        COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
        )::bigint AS posted_proxy,
        COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
        )::bigint AS posted_real,
        ROUND(100.0 * COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
        ) / NULLIF(COUNT(*), 0), 2)::float8 AS pct_real
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
      GROUP BY source
      ORDER BY total DESC
    `);

    const leadTime = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        source,
        COUNT(*)::bigint AS rows_with_real_postedAt,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400
        )::numeric, 2)::float8 AS p50_lead_days,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400
        )::numeric, 2)::float8 AS p95_lead_days,
        ROUND(MAX(EXTRACT(EPOCH FROM ("createdAt" - "postedAt"))/86400)::numeric, 2)::float8 AS max_lead_days
      FROM "Job"
      WHERE "canonicalJobId" IS NULL
        AND "postedAt" IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
      GROUP BY source
      ORDER BY rows_with_real_postedAt DESC
    `);

    const greenhouseLeak = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        COUNT(*)::bigint AS greenhouse_total,
        COUNT(*) FILTER (WHERE "postedAt" >= NOW() - INTERVAL '7 days')::bigint AS recent_7d,
        COUNT(*) FILTER (WHERE "postedAt" >= NOW() - INTERVAL '24 hours')::bigint AS recent_24h,
        ROUND(100.0 * COUNT(*) FILTER (
          WHERE "postedAt" >= NOW() - INTERVAL '24 hours'
        ) / NULLIF(COUNT(*), 0), 2)::float8 AS pct_24h
      FROM "Job"
      WHERE source = 'greenhouse'
        AND "canonicalJobId" IS NULL AND "isActive" = true
    `);

    const discoveryBuckets = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        CASE
          WHEN "createdAt" >= NOW() - INTERVAL '24 hours' THEN '00_lt_24h'
          WHEN "createdAt" >= NOW() - INTERVAL '7 days'   THEN '01_lt_7d'
          WHEN "createdAt" >= NOW() - INTERVAL '30 days'  THEN '02_lt_30d'
          WHEN "createdAt" >= NOW() - INTERVAL '90 days'  THEN '03_lt_90d'
          ELSE                                                  '04_ge_90d'
        END AS bucket,
        COUNT(*)::bigint AS rows
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
        AND "postedAt" IS NULL
      GROUP BY 1
      ORDER BY 1
    `);

    const sharedTs = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        source,
        "postedAt"::text AS posted_at,
        COUNT(*)::bigint AS rows_sharing_timestamp
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
        AND "postedAt" IS NOT NULL
      GROUP BY source, "postedAt"
      HAVING COUNT(*) >= 25
      ORDER BY rows_sharing_timestamp DESC
      LIMIT 50
    `);

    const duplicateDrift = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        COUNT(*)::bigint AS duplicates_with_posted,
        COUNT(*) FILTER (WHERE d."postedAt" < c."postedAt")::bigint AS earlier_than_canonical,
        COUNT(*) FILTER (WHERE d."postedAt" > c."postedAt")::bigint AS later_than_canonical,
        COUNT(*) FILTER (WHERE d."postedAt" = c."postedAt")::bigint AS equal_to_canonical
      FROM "Job" d
      JOIN "Job" c ON c.id = d."canonicalJobId"
      WHERE d."canonicalJobId" IS NOT NULL
        AND d."postedAt" IS NOT NULL
        AND c."postedAt" IS NOT NULL
    `);

    const listingFreshnessBuckets = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        CASE
          WHEN "listingFreshnessAt" >= NOW() - INTERVAL '24 hours' THEN '00_lt_24h'
          WHEN "listingFreshnessAt" >= NOW() - INTERVAL '7 days'   THEN '01_lt_7d'
          WHEN "listingFreshnessAt" >= NOW() - INTERVAL '30 days'  THEN '02_lt_30d'
          WHEN "listingFreshnessAt" >= NOW() - INTERVAL '90 days'  THEN '03_lt_90d'
          ELSE                                                          '04_ge_90d'
        END AS bucket,
        COUNT(*)::bigint AS rows,
        COUNT(*) FILTER (WHERE "postedAt" IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) >= 60
        )::bigint AS rows_real_posted,
        COUNT(*) FILTER (WHERE "postedAt" IS NULL)::bigint AS rows_discovered_only
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
        AND ("status" = 'ready' OR "status" IS NULL)
      GROUP BY 1
      ORDER BY 1
    `);

    const sizing = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        COUNT(*)::bigint AS canonical_active,
        COUNT(*) FILTER (WHERE "postedAt" IS NULL)::bigint AS posted_null_active,
        COUNT(*) FILTER (
          WHERE "postedAt" IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM ("postedAt" - "createdAt"))) < 60
        )::bigint AS posted_proxy_active
      FROM "Job"
      WHERE "canonicalJobId" IS NULL AND "isActive" = true
    `);

    const report = {
      capturedAt: startedAt,
      sections: {
        overallCoverage: overall.map(numify),
        proxyContamination: proxy.map(numify),
        coverageBySource: bySource.map(numify),
        leadTimeBySource: leadTime.map(numify),
        greenhouseUpdatedAtLeak: greenhouseLeak.map(numify),
        discoveryOnlyAgeBuckets: discoveryBuckets.map(numify),
        sharedPostedAtBatches: sharedTs.map(numify),
        canonicalDuplicatePostedAtDrift: duplicateDrift.map(numify),
        listingFreshnessAtBuckets: listingFreshnessBuckets.map(numify),
        sizing: sizing.map(numify),
      },
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("# Freshness data-quality audit");
      console.log(`Captured at: ${startedAt}\n`);
      for (const [section, rows] of Object.entries(report.sections)) {
        console.log(`## ${section}`);
        console.log("```json");
        console.log(JSON.stringify(rows, null, 2));
        console.log("```\n");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
