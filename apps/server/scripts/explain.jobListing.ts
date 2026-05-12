/**
 * Prints Postgres EXPLAIN for the exact discovery id-list query used by `findManyCanonicalFiltered`
 * (`sqlForCanonicalListingIds` in job.repository.ts). Safe for manual DBA use — does not run in production traffic.
 *
 * Usage (from repo root, with DATABASE_URL):
 *   npm run explain:job-listing -w @jobseek/server
 *   npm run explain:job-listing -w @jobseek/server -- --analyze
 *   npm run explain:job-listing -w @jobseek/server -- --scenario=category --analyze
 *   npm run explain:job-listing -w @jobseek/server -- --scenario=role --role=engineer
 *   npm run explain:job-listing -w @jobseek/server -- --scenario=posted --analyze
 *   npm run explain:job-listing -w @jobseek/server -- --sort=salary_desc --limit=20 --offset=0
 *
 * Scenarios: bare | category | role | posted  (default: bare)
 * `--analyze` executes the query (read-heavy); omit on production primary if preferred.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import {
  sqlForCanonicalListingIds,
  type JobDiscoveryFilters,
} from "../src/modules/job/job.repository.js";

loadRootEnv();

function argValue(prefix: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  return raw.slice(prefix.length);
}

function scenarioFilters(scenario: string): JobDiscoveryFilters | undefined {
  switch (scenario) {
    case "bare":
      return undefined;
    case "category":
      return { category: "engineering" };
    case "role": {
      const role = argValue("--role=") ?? "engineer";
      return { role };
    }
    case "posted":
      return { postedWithin: "1w" };
    default:
      console.error(`Unknown --scenario=${scenario} (use bare|category|role|posted)`);
      process.exitCode = 1;
      return undefined;
  }
}

async function main(): Promise<void> {
  const analyze = process.argv.includes("--analyze");
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required (load .env at repo root or export it).");
    process.exitCode = 1;
    return;
  }

  const scenario = argValue("--scenario=") ?? "bare";
  const sortRaw = argValue("--sort=") ?? "latest";
  const sort = sortRaw === "salary_desc" || sortRaw === "salary" ? "salary_desc" : "latest";
  const limit = Math.max(1, parseInt(argValue("--limit=") ?? "20", 10) || 20);
  const offset = Math.max(0, parseInt(argValue("--offset=") ?? "0", 10) || 0);

  const filters = scenarioFilters(scenario);
  if (filters === undefined && scenario !== "bare") {
    return;
  }

  const compareLegacy = process.argv.includes("--compare-legacy");

  const idSql = sqlForCanonicalListingIds({
    filters,
    sort,
    limit,
    offset,
    includeProcessing: false,
  });

  const prisma = new PrismaClient();

  /**
   * Legacy ORDER BY (pre Phase-5 overhaul), kept here only for EXPLAIN diffing.
   * Do not use as a runtime path — production reads always go through
   * `sqlForCanonicalListingIds`.
   */
  function legacyLatestSql(): Prisma.Sql {
    if (sort !== "latest") return idSql;
    return Prisma.sql`
      SELECT j.id FROM "Job" j
      WHERE 1=1
      ORDER BY j."listingFreshnessAt" DESC, j."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async function explainOne(label: string, sqlToExplain: Prisma.Sql) {
    const rows = analyze
      ? await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS)
          ${sqlToExplain}
        `)
      : await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
          EXPLAIN
          ${sqlToExplain}
        `);
    console.log(`\n=== ${label} ${analyze ? "(ANALYZE, BUFFERS)" : ""} ===`);
    console.log(rows.map((r) => r["QUERY PLAN"]).join("\n"));
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  }

  try {
    console.log("--- parameters ---");
    console.log(JSON.stringify({ scenario, sort, limit, offset, filters: filters ?? null }, null, 2));
    console.log("\n--- id-list query (same shape as findManyCanonicalFiltered) ---");
    console.log(
      "(Parameterized; Prisma sends bound values. Run EXPLAIN in psql with your literal values if needed.)\n",
    );

    const planText = await explainOne("CURRENT (postedAt DESC NULLS LAST, listingFreshnessAt DESC, createdAt DESC, id)", idSql);
    if (compareLegacy) {
      await explainOne("LEGACY  (listingFreshnessAt DESC, createdAt DESC) — pre-Phase-5 baseline", legacyLatestSql());
    }

    const rows = [{ "QUERY PLAN": planText }];

    const text = rows.map((r) => r["QUERY PLAN"]).join("\n").toLowerCase();
    const usesFreshnessIdx = text.includes("idx_jobs_listing_freshness_at");
    const seqScan = text.includes("seq scan") && text.includes("job");
    const salarySort = sort === "salary_desc";
    const mentionsSalaryOrder =
      text.includes("salarymin") || text.includes("salary_min") || text.includes('"salarymin"');
    const externalSort = text.includes("external merge") || text.includes("quicksort") || text.includes("sort");
    console.log("\n--- hints ---");
    console.log(`idx_jobs_listing_freshness_at mentioned: ${usesFreshnessIdx}`);
    console.log(`possible Seq Scan on Job: ${seqScan}`);
    console.log(`sort mode: ${sort}${salarySort ? " (expect ORDER BY salaryMin DESC NULLS LAST, createdAt DESC)" : ""}`);
    console.log(`plan mentions salary / order path: ${mentionsSalaryOrder}`);
    console.log(`sort-related nodes present (merge/quicksort): ${externalSort}`);
    console.log(
      "\nHigh variance on salary_desc often comes from: (1) id-list query cost swings, (2) partial/index mismatch on salaryMin + filters, (3) buffer pool / concurrent load, (4) PgBouncer pool wait — correlate with JOB_LIST_METERED_SLOW + PRISMA_QUERY_DIAG + /internal/db/pg-activity.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
