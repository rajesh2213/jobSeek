/**
 * Forensic read-only analysis: primary canonical jobs stuck in `processing`.
 * Run: cd apps/server && npx tsx scripts/ingestion/forensicPrimaryProcessing.ts
 * Optional: --sample 20   (oldest-row samples, 1–100)
 * Optional: --deep        slower diagnostics (duplicate bands, samples per top patterns)
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";

loadRootEnv();

function parseSample(argv: string[]): number {
  const i = argv.indexOf("--sample");
  if (i < 0) return 8;
  const n = Number.parseInt(argv[i + 1] ?? "", 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return 8;
  return n;
}

function parseDeep(argv: string[]): boolean {
  return argv.includes("--deep");
}

void (async () => {
  const argv = process.argv.slice(2);
  const sample = parseSample(argv);
  const deep = parseDeep(argv);

  const buckets = await prisma.$queryRaw<
    Array<{
      bucket: string;
      n: bigint;
    }>
  >`
    SELECT
      CASE
        WHEN "parsedDescription" IS NOT NULL THEN 'has_parsed'
        WHEN char_length(BTRIM(COALESCE("description", ''))) > 100 THEN 'long_desc_no_parse'
        WHEN char_length(BTRIM(COALESCE("description", ''))) = 0 OR "description" IS NULL THEN 'empty_desc'
        ELSE 'short_desc_no_parse'
      END AS bucket,
      COUNT(*)::bigint AS n
    FROM "Job"
    WHERE "canonicalJobId" IS NULL
      AND "status" = 'processing'
      AND "isActive"
    GROUP BY 1
    ORDER BY n DESC
  `;

  const topLifecyclePatterns = await prisma.$queryRaw<
    Array<{ pattern: string; n: bigint }>
  >`
    SELECT
      CONCAT(
        'parse:', CASE WHEN "parsedDescription" IS NOT NULL THEN 'y' ELSE 'n' END,
        '|enrich:', CASE
          WHEN "enriched" IS NOT NULL AND "enriched"::text NOT IN ('null', '{}') THEN 'y'
          ELSE 'n'
        END,
        '|apply:', CASE
          WHEN "applyUrl" IS NOT NULL AND BTRIM("applyUrl") <> '' THEN 'y'
          ELSE 'n'
        END
      ) AS pattern,
      COUNT(*)::bigint AS n
    FROM "Job"
    WHERE "canonicalJobId" IS NULL
      AND "status" = 'processing'
      AND "isActive"
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 25
  `;

  const bySource = await prisma.$queryRaw<
    Array<{ source: string; n: bigint; min_updated: Date; max_updated: Date }>
  >`
    SELECT
      source,
      COUNT(*)::bigint AS n,
      MIN("updatedAt") AS min_updated,
      MAX("updatedAt") AS max_updated
    FROM "Job"
    WHERE "canonicalJobId" IS NULL
      AND "status" = 'processing'
      AND "isActive"
    GROUP BY source
    ORDER BY n DESC
    LIMIT 40
  `;

  const updatedAtStalenessBands = await prisma.$queryRaw<
    Array<{
      updated_within_1h: bigint;
      stale_1h_to_24h: bigint;
      stale_24h_to_7d: bigint;
      stale_gt_7d: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "updatedAt" >= NOW() - INTERVAL '1 hour')::bigint AS updated_within_1h,
      COUNT(*) FILTER (
        WHERE "updatedAt" < NOW() - INTERVAL '1 hour'
          AND "updatedAt" >= NOW() - INTERVAL '24 hours'
      )::bigint AS stale_1h_to_24h,
      COUNT(*) FILTER (
        WHERE "updatedAt" < NOW() - INTERVAL '24 hours'
          AND "updatedAt" >= NOW() - INTERVAL '7 days'
      )::bigint AS stale_24h_to_7d,
      COUNT(*) FILTER (WHERE "updatedAt" < NOW() - INTERVAL '7 days')::bigint AS stale_gt_7d
    FROM "Job"
    WHERE "canonicalJobId" IS NULL
      AND "status" = 'processing'
      AND "isActive"
  `;

  const samples = await prisma.$queryRaw<
    Array<{
      id: string;
      source: string;
      title: string;
      desc_len: number;
      has_parsed: boolean;
      has_enriched: boolean;
      has_apply_url: boolean;
      updated_at: Date;
    }>
  >`
    SELECT
      j.id,
      j.source,
      LEFT(j.title, 80) AS title,
      char_length(BTRIM(COALESCE(j.description, '')))::int AS desc_len,
      (j."parsedDescription" IS NOT NULL) AS has_parsed,
      (j."enriched" IS NOT NULL AND j."enriched"::text NOT IN ('null', '{}')) AS has_enriched,
      (j."applyUrl" IS NOT NULL AND BTRIM(j."applyUrl") <> '') AS has_apply_url,
      j."updatedAt" AS updated_at
    FROM "Job" j
    WHERE j."canonicalJobId" IS NULL
      AND j."status" = 'processing'
      AND j."isActive"
    ORDER BY j."updatedAt" ASC
    LIMIT ${sample}
  `;

  let canonicalDuplicateBands: Array<{ band: string; n: bigint }> | null = null;
  const samplesByPattern: Record<string, string[]> = {};

  if (deep) {
    canonicalDuplicateBands = await prisma.$queryRaw<
      Array<{ band: string; n: bigint }>
    >`
      SELECT band, COUNT(*)::bigint AS n
      FROM (
        SELECT
          CASE
            WHEN dc.c = 0::bigint THEN '0_active_dupes'
            WHEN dc.c <= 2::bigint THEN '1_2_dupes'
            WHEN dc.c <= 10::bigint THEN '3_10_dupes'
            ELSE '11+_dupes'
          END AS band
        FROM "Job" j
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::bigint AS c
          FROM "Job" d
          WHERE d."canonicalJobId" = j.id AND d."isActive"
        ) dc ON TRUE
        WHERE j."canonicalJobId" IS NULL
          AND j."status" = 'processing'
          AND j."isActive"
      ) sub
      GROUP BY band
      ORDER BY n DESC
    `;

    const topPatterns = topLifecyclePatterns.slice(0, 5);
    for (const row of topPatterns) {
      const pat = row.pattern;
      const ids = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT j.id
        FROM "Job" j
        WHERE j."canonicalJobId" IS NULL
          AND j."status" = 'processing'
          AND j."isActive"
          AND CONCAT(
            'parse:', CASE WHEN j."parsedDescription" IS NOT NULL THEN 'y' ELSE 'n' END,
            '|enrich:', CASE
              WHEN j."enriched" IS NOT NULL AND j."enriched"::text NOT IN ('null', '{}') THEN 'y'
              ELSE 'n'
            END,
            '|apply:', CASE
              WHEN j."applyUrl" IS NOT NULL AND BTRIM(j."applyUrl") <> '' THEN 'y'
              ELSE 'n'
            END
          ) = ${pat}
        ORDER BY j."updatedAt" ASC
        LIMIT 8
      `);
      samplesByPattern[pat] = ids.map((r) => r.id);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    flags: { sample, deep },
    interpretation: {
      publicListing:
        "Primary rows require status ready or null (see job.repository readyStatusWhere). processing = not visible.",
      reconcilePathParsed:
        "jobStatusReconcile promotes processing -> ready when parsedDescription IS NOT NULL.",
      reconcilePathLongDesc:
        "Opt-in JOB_STATUS_RECONCILE_LONG_DESC_READY=true promotes long-description primaries without parse (matches backfill heuristic).",
      atsWorkerPath:
        "ATS worker skips enrich when shouldSkipParse (content hash); stale primaries may lack parse if never parsed.",
      lifecyclePatternLegend:
        "topLifecyclePatterns keys: parse=y|n, enrich=y|n (non-empty enriched JSON), apply=y|n (non-empty applyUrl).",
    },
    buckets,
    topLifecyclePatterns,
    bySource,
    updatedAtStalenessBands: updatedAtStalenessBands[0] ?? null,
    canonicalDuplicateBands,
    samplesByPattern: deep ? samplesByPattern : undefined,
    oldestSamplesFirst: samples,
  };

  console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
