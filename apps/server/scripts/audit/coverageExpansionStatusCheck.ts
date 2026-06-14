/**
 * Status check for manually ingested endpoints (batch 50 + batch 100).
 * Run: npx tsx scripts/audit/coverageExpansionStatusCheck.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";

loadRootEnv();

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "../../../..");

type BatchRow = {
  company: string;
  domain: string;
  atsType: string;
  slug: string;
  companyId: string;
  endpointId: string;
};

type AuditJobCount = { company: string; jobCount: number };

function loadBatch50(): { appliedAt: string; rows: BatchRow[] } {
  const post = JSON.parse(
    readFileSync(resolve(ROOT, "docs/rollout/coverage-expansion-50-post-ingest.json"), "utf8"),
  ) as { generatedAt: string; rows: BatchRow[] };
  return { appliedAt: post.generatedAt, rows: post.rows };
}

function loadBatch100(): { appliedAt: string; rows: BatchRow[] } {
  const post = JSON.parse(
    readFileSync(resolve(ROOT, "docs/rollout/coverage-expansion-100-post-ingest.json"), "utf8"),
  ) as { appliedAt: string; rows: BatchRow[] };
  return { appliedAt: post.appliedAt, rows: post.rows };
}

function loadAuditJobCounts(batch: "50" | "100"): Map<string, number> {
  const audit = JSON.parse(
    readFileSync(resolve(ROOT, `docs/rollout/coverage-expansion-${batch}-audit.json`), "utf8"),
  ) as { top50?: AuditJobCount[]; top100?: AuditJobCount[] };
  const list = batch === "50" ? audit.top50 ?? [] : audit.top100 ?? [];
  return new Map(list.map((r) => [r.company, r.jobCount]));
}

async function statusForBatch(
  name: string,
  appliedAt: string,
  rows: BatchRow[],
  auditJobs: Map<string, number>,
) {
  const endpointIds = rows.map((r) => r.endpointId);
  const companyIds = rows.map((r) => r.companyId);

  const endpoints = await prisma.atsEndpoint.findMany({
    where: { id: { in: endpointIds } },
    select: {
      id: true,
      type: true,
      slug: true,
      isActive: true,
      score: true,
      lastCrawledAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      successCount: true,
      failureCount: true,
      companyId: true,
    },
  });
  const epById = new Map(endpoints.map((e) => [e.id, e]));

  const jobCounts = await prisma.$queryRaw<
    { companyId: string; job_count: bigint }[]
  >`
    SELECT "companyId", COUNT(*)::bigint AS job_count
    FROM "Job"
    WHERE "companyId" = ANY(${companyIds})
    GROUP BY "companyId"
  `;
  const jobsByCompany = new Map(jobCounts.map((j) => [j.companyId, Number(j.job_count)]));

  const detail = rows.map((r) => {
    const ep = epById.get(r.endpointId);
    const ingested = jobsByCompany.get(r.companyId) ?? 0;
    const validated = auditJobs.get(r.company) ?? null;
    const capturePct =
      validated && validated > 0 ? Math.round((ingested / validated) * 1000) / 10 : null;
    return {
      company: r.company,
      domain: r.domain,
      atsType: r.atsType,
      slug: r.slug,
      companyId: r.companyId,
      endpointId: r.endpointId,
      isActive: ep?.isActive ?? false,
      lastCrawledAt: ep?.lastCrawledAt?.toISOString() ?? null,
      lastSuccessAt: ep?.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: ep?.lastFailureAt?.toISOString() ?? null,
      successCount: ep?.successCount ?? 0,
      failureCount: ep?.failureCount ?? 0,
      validatedJobCount: validated,
      jobsIngested: ingested,
      capturePct,
      crawled: Boolean(ep?.lastCrawledAt),
      succeeded: Boolean(ep?.lastSuccessAt),
      failed: (ep?.failureCount ?? 0) > 0 && !ep?.lastSuccessAt,
    };
  });

  const crawled = detail.filter((d) => d.crawled);
  const succeeded = detail.filter((d) => d.succeeded);
  const pending = detail.filter((d) => !d.crawled);
  const withJobs = detail.filter((d) => d.jobsIngested > 0);
  const anomalies = detail.filter(
    (d) =>
      d.crawled &&
      d.validatedJobCount != null &&
      d.validatedJobCount >= 5 &&
      d.jobsIngested < d.validatedJobCount * 0.2,
  );

  const byAts: Record<string, { total: number; crawled: number; jobs: number }> = {};
  for (const d of detail) {
    const b = byAts[d.atsType] ?? { total: 0, crawled: 0, jobs: 0 };
    b.total++;
    if (d.crawled) b.crawled++;
    b.jobs += d.jobsIngested;
    byAts[d.atsType] = b;
  }

  return {
    batch: name,
    appliedAt,
    checkedAt: new Date().toISOString(),
    totals: {
      endpoints: detail.length,
      active: detail.filter((d) => d.isActive).length,
      crawled: crawled.length,
      crawledPct: Math.round((crawled.length / detail.length) * 1000) / 10,
      succeeded: succeeded.length,
      pendingCrawl: pending.length,
      withJobs: withJobs.length,
      totalJobsIngested: detail.reduce((s, d) => s + d.jobsIngested, 0),
      totalValidatedAtAudit: detail.reduce((s, d) => s + (d.validatedJobCount ?? 0), 0),
      anomalies: anomalies.length,
    },
    byAts,
    anomalies,
    pending: pending.map((d) => ({
      company: d.company,
      atsType: d.atsType,
      slug: d.slug,
      validatedJobCount: d.validatedJobCount,
    })),
    topPerformers: [...detail]
      .sort((a, b) => b.jobsIngested - a.jobsIngested)
      .slice(0, 15)
      .map((d) => ({
        company: d.company,
        atsType: d.atsType,
        validated: d.validatedJobCount,
        ingested: d.jobsIngested,
        capturePct: d.capturePct,
      })),
    rows: detail,
  };
}

async function main(): Promise<void> {
  const batch50 = loadBatch50();
  const batch100 = loadBatch100();

  const [s50, s100] = await Promise.all([
    statusForBatch("coverage_expansion_50", batch50.appliedAt, batch50.rows, loadAuditJobCounts("50")),
    statusForBatch("coverage_expansion_100", batch100.appliedAt, batch100.rows, loadAuditJobCounts("100")),
  ]);

  const combined = {
    checkedAt: new Date().toISOString(),
    batches: [s50, s100],
    combined: {
      endpoints: s50.totals.endpoints + s100.totals.endpoints,
      crawled: s50.totals.crawled + s100.totals.crawled,
      crawledPct:
        Math.round(
          ((s50.totals.crawled + s100.totals.crawled) /
            (s50.totals.endpoints + s100.totals.endpoints)) *
            1000,
        ) / 10,
      jobsIngested: s50.totals.totalJobsIngested + s100.totals.totalJobsIngested,
      pendingCrawl: s50.totals.pendingCrawl + s100.totals.pendingCrawl,
      anomalies: s50.totals.anomalies + s100.totals.anomalies,
    },
  };

  const outPath = resolve(ROOT, "docs/rollout/coverage-expansion-status-check.json");
  writeFileSync(outPath, JSON.stringify(combined, null, 2));
  console.log(JSON.stringify({ batch50: s50.totals, batch100: s100.totals, combined: combined.combined }, null, 2));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
