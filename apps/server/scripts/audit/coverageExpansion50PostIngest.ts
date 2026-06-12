/**
 * Phase 9 post-ingest report for coverage expansion 50.
 * Run: npx tsx scripts/audit/coverageExpansion50PostIngest.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";

loadRootEnv();

type CreatedRow = {
  company: string;
  domain: string;
  atsType: string;
  slug: string;
  companyId: string;
  endpointId: string;
  enqueueAction?: string;
};

async function main(): Promise<void> {
  const apply = JSON.parse(readFileSync("/tmp/coverage-expansion-50-apply.json", "utf8")) as {
    results: Array<{
      company: string;
      domain: string;
      atsType: string;
      slug: string;
      status: string;
      companyId?: string;
      endpointId?: string;
      enqueueAction?: string;
      error?: string;
    }>;
    stats: Record<string, number>;
  };

  const supplement = JSON.parse(
    readFileSync("/tmp/coverage-expansion-50-supplement.json", "utf8"),
  ) as Array<{
    company: string;
    status: string;
    companyId?: string;
    endpointId?: string;
    slug?: string;
    enqueueAction?: string;
    note?: string;
  }>;

  const created: CreatedRow[] = [
    ...apply.results
      .filter((r) => r.status === "created" && r.companyId && r.endpointId)
      .map((r) => ({
        company: r.company,
        domain: r.domain,
        atsType: r.atsType,
        slug: r.slug,
        companyId: r.companyId!,
        endpointId: r.endpointId!,
        enqueueAction: r.enqueueAction,
      })),
    ...supplement
      .filter((r) => r.status === "created" && r.companyId && r.endpointId)
      .map((r) => ({
        company: r.company,
        domain: r.company === "Hazel" ? "hazel.ai" : "atob.com",
        atsType: "ashby",
        slug: r.slug!,
        companyId: r.companyId!,
        endpointId: r.endpointId!,
        enqueueAction: r.enqueueAction,
      })),
  ];

  const endpointIds = created.map((c) => c.endpointId);

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

  const companyIds = created.map((c) => c.companyId);
  const jobCounts = await prisma.$queryRaw<
    { companyId: string; job_count: bigint }[]
  >`
    SELECT "companyId", COUNT(*)::bigint AS job_count
    FROM "Job"
    WHERE "companyId" = ANY(${companyIds})
    GROUP BY "companyId"
  `;
  const jobsByCompany = new Map(jobCounts.map((j) => [j.companyId, Number(j.job_count)]));

  const rows = created.map((c) => {
    const ep = epById.get(c.endpointId);
    return {
      company: c.company,
      domain: c.domain,
      atsType: c.atsType,
      slug: c.slug,
      companyId: c.companyId,
      endpointId: c.endpointId,
      enqueueAction: c.enqueueAction,
      isActive: ep?.isActive ?? false,
      endpointScore: ep?.score ?? 0,
      lastCrawledAt: ep?.lastCrawledAt?.toISOString() ?? null,
      lastSuccessAt: ep?.lastSuccessAt?.toISOString() ?? null,
      successCount: ep?.successCount ?? 0,
      failureCount: ep?.failureCount ?? 0,
      jobsDiscovered: jobsByCompany.get(c.companyId) ?? 0,
      crawled: Boolean(ep?.lastCrawledAt),
    };
  });

  const activeBefore = Number(
    (await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive"`)[0]?.c ?? 0,
  );
  const jobsBefore = 87331;
  const jobsNow = Number((await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "Job"`)[0]?.c ?? 0);

  const report = {
    phase: "PHASE_9_POST_INGEST_REPORT",
    generatedAt: new Date().toISOString(),
    summary: {
      endpointsAdded: created.length,
      endpointsActive: rows.filter((r) => r.isActive).length,
      endpointsCrawled: rows.filter((r) => r.crawled).length,
      endpointsFailed: rows.filter((r) => r.failureCount > 0 && !r.crawled).length,
      totalJobsDiscovered: rows.reduce((s, r) => s + r.jobsDiscovered, 0),
      jobsDelta: jobsNow - jobsBefore,
      activeEndpointsBefore: 859,
      activeEndpointsAfter: activeBefore,
      activeEndpointsDelta: activeBefore - 859,
      skippedDuringApply: apply.results.filter((r) => r.status === "skipped_existing"),
      supplementApplied: supplement,
    },
    rows,
  };

  writeFileSync("/tmp/coverage-expansion-50-post-ingest.json", JSON.stringify(report, null, 2));
  writeFileSync(
    "/home/ubuntu/jobSeek/docs/rollout/coverage-expansion-50-post-ingest.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.summary, null, 2));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
