/**
 * Validate endpoints for recovered Class B companies only (no global discovery).
 * Fetches jobs via crawler; activates endpoint when jobs >= 1; enqueues ingest for persistence.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/validateRecoveredClassB.ts [--dry-run] [--limit=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { createAtsCrawlerStandard } from "../../src/modules/ats/AtsCrawlerStandard.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { createAtsEndpointService } from "../../src/modules/atsEndpoint/atsEndpoint.service.js";
import {
  ACTIVATION_TAG,
  fetchRecoveredCompanies,
  mergeTag,
  RECOVERED_TAG,
} from "../rollout/classBActivationLib.js";
import {
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
  closeIngestAtsEndpointQueue,
} from "../../src/queues/ats-endpoint.queue.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

async function main(): Promise<void> {
  console.log(`=== Validate Recovered Class B (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  let companies = await fetchRecoveredCompanies(prisma);
  if (LIMIT < companies.length) companies = companies.slice(0, LIMIT);

  const endpointService = createAtsEndpointService(prisma);
  const ingestQueue = DRY_RUN ? null : getIngestAtsEndpointQueue();

  const stats = {
    companies: companies.length,
    endpointsChecked: 0,
    success: 0,
    failure: 0,
    jobsFound: 0,
    ingestEnqueued: 0,
  };

  for (const c of companies) {
    const endpoints = await prisma.atsEndpoint.findMany({
      where: { companyId: c.id },
      select: {
        id: true,
        type: true,
        slug: true,
        baseUrl: true,
        metadata: true,
        companyId: true,
        companyName: true,
        isActive: true,
      },
    });

    if (endpoints.length === 0) {
      console.log(`SKIP ${c.name}: no endpoint`);
      continue;
    }

    for (const ep of endpoints) {
      stats.endpointsChecked++;
      const atsType = ep.type as AtsType;
      let jobs: Awaited<ReturnType<ReturnType<typeof createAtsCrawlerStandard>["fetchJobs"]>> = [];

      try {
        const standard = createAtsCrawlerStandard(atsType);
        jobs = await standard.fetchJobs({
          id: ep.id,
          type: atsType,
          slug: ep.slug,
          baseUrl: ep.baseUrl,
          metadata: ep.metadata,
          companyId: ep.companyId,
          companyName: ep.companyName?.trim() || c.name,
        });
      } catch (err) {
        stats.failure++;
        console.log(`FAIL ${c.name} ${ep.type}/${ep.slug}: ${err instanceof Error ? err.message : String(err)}`);
        if (!DRY_RUN) await endpointService.markFailure(ep.id);
        continue;
      }

      const jobCount = jobs.length;
      stats.jobsFound += jobCount;

      if (jobCount >= 1) {
        stats.success++;
        console.log(`PASS ${c.name} ${ep.type}/${ep.slug} jobs=${jobCount}`);
        if (!DRY_RUN) {
          const now = new Date();
          await prisma.atsEndpoint.update({
            where: { id: ep.id },
            data: {
              isActive: true,
              failureCount: 0,
              successCount: { increment: 1 },
              lastCheckedAt: now,
              lastSuccessAt: now,
              lastCrawledAt: now,
            },
          });
          await prisma.company.update({
            where: { id: c.id },
            data: {
              discoverySource: mergeTag(
                (await prisma.company.findUnique({ where: { id: c.id }, select: { discoverySource: true } }))
                  ?.discoverySource ?? null,
                `${ACTIVATION_TAG}:validated`,
              ),
            },
          });
          if (ingestQueue) {
            await ingestQueue.add(
              INGEST_ATS_ENDPOINT_JOB,
              { endpointId: ep.id },
              { jobId: `class-b-validate-${ep.id}-${Date.now()}` },
            );
            stats.ingestEnqueued++;
          }
        }
      } else {
        stats.failure++;
        console.log(`FAIL ${c.name} ${ep.type}/${ep.slug}: zero_jobs`);
        if (!DRY_RUN) await endpointService.markFailure(ep.id);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify({ ...stats, tag: RECOVERED_TAG }, null, 2));
  await closeIngestAtsEndpointQueue();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
