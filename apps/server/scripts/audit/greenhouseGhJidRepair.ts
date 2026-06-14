/**
 * Repair Greenhouse gh_jid URL collapse: delete placeholder jobs, re-ingest, verify.
 * Run: npx tsx scripts/audit/greenhouseGhJidRepair.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { createAtsCrawlerStandard } from "../../src/modules/ats/AtsCrawlerStandard.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { createJobRepository } from "../../src/modules/job/job.repository.js";
import { JobService } from "../../src/modules/job/job.service.js";
import { extractCompanyDomain } from "../../src/utils/jobFingerprint.js";
import { normalizeJobUrl } from "../../src/utils/normalizeJobUrl.js";
import {
  closeIngestAtsEndpointQueue,
  getIngestAtsEndpointQueue,
} from "../../src/queues/ats-endpoint.queue.js";
import { enqueueAtsEndpointIngest } from "../../src/queues/atsEndpointEnqueue.js";

loadRootEnv();

const __dir = dirname(fileURLToPath(import.meta.url));
const KNOWN_AFFECTED = [
  "Navan",
  "Sendbird",
  "Lattice",
  "Wayve",
  "Plume",
  "Symphony",
] as const;

type EndpointRow = {
  company: string;
  endpointId: string;
  companyId: string;
  slug: string;
};

async function loadAffectedEndpoints(): Promise<EndpointRow[]> {
  const status = JSON.parse(
    readFileSync(resolve(__dir, "../../../../docs/rollout/coverage-expansion-status-check.json"), "utf8"),
  ) as {
    batches: Array<{
      rows: Array<{
        company: string;
        atsType: string;
        endpointId: string;
        companyId: string;
        slug: string;
        validatedJobCount: number;
        jobsIngested: number;
      }>;
    }>;
  };

  const fromStatus = status.batches
    .flatMap((b) => b.rows)
    .filter(
      (r) =>
        r.atsType === "greenhouse" &&
        KNOWN_AFFECTED.includes(r.company as (typeof KNOWN_AFFECTED)[number]) &&
        r.validatedJobCount >= 5 &&
        r.jobsIngested <= 2,
    )
    .map((r) => ({
      company: r.company,
      endpointId: r.endpointId,
      companyId: r.companyId,
      slug: r.slug,
    }));

  return fromStatus;
}

function isCollapsedGreenhouseUrl(sourceUrl: string): boolean {
  const n = normalizeJobUrl(sourceUrl);
  return !n.includes("gh_jid=") && !n.includes("greenhouse.io/");
}

async function deleteCollapsedPlaceholderJobs(companyId: string): Promise<number> {
  const jobs = await prisma.job.findMany({
    where: { companyId, source: "greenhouse" },
    select: { id: true, sourceUrl: true, title: true },
  });
  const toDelete = jobs.filter((j) => isCollapsedGreenhouseUrl(j.sourceUrl));
  if (toDelete.length === 0) return 0;
  await prisma.job.deleteMany({ where: { id: { in: toDelete.map((j) => j.id) } } });
  return toDelete.length;
}

async function inlineReingest(
  endpointId: string,
  companyId: string,
  careersUrl: string | null,
): Promise<{ fetched: number; inserted: number; skipped: number }> {
  const endpoint = await prisma.atsEndpoint.findUnique({
    where: { id: endpointId },
    select: {
      id: true,
      type: true,
      slug: true,
      baseUrl: true,
      metadata: true,
      companyId: true,
      companyName: true,
    },
  });
  if (!endpoint?.companyId) throw new Error(`endpoint missing companyId: ${endpointId}`);

  const jobRepository = createJobRepository(prisma);
  const jobService = new JobService(jobRepository);
  const standard = createAtsCrawlerStandard(endpoint.type as AtsType);
  const normalizedJobs = await standard.fetchJobs(endpoint);
  const companyDomain = extractCompanyDomain(careersUrl, companyId);

  let inserted = 0;
  let skipped = 0;
  const seenAt = new Date();

  for (const job of normalizedJobs) {
    const { inserted: ins } = await jobService.ingestDeduplicated(
      { ...job, companyDomain },
      { batchTouchAtMs: seenAt.getTime() },
    );
    if (ins) inserted += 1;
    else skipped += 1;
  }

  await prisma.atsEndpoint.update({
    where: { id: endpointId },
    data: {
      lastCrawledAt: seenAt,
      lastSuccessAt: seenAt,
      lastCheckedAt: seenAt,
      successCount: { increment: 1 },
    },
  });

  return { fetched: normalizedJobs.length, inserted, skipped };
}

async function probeLiveJobCount(slug: string): Promise<number> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
    headers: { "User-Agent": "JobLoom/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return 0;
  const body = (await res.json()) as { jobs?: unknown[] };
  return body.jobs?.length ?? 0;
}

async function main(): Promise<void> {
  const affected = await loadAffectedEndpoints();
  if (affected.length === 0) {
    throw new Error("No affected endpoints found");
  }

  const report: Record<string, unknown>[] = [];

  for (const row of affected) {
    const company = await prisma.company.findUnique({
      where: { id: row.companyId },
      select: { careersUrl: true },
    });
    const beforeCount = await prisma.job.count({ where: { companyId: row.companyId } });
    const deleted = await deleteCollapsedPlaceholderJobs(row.companyId);
    const ingest = await inlineReingest(row.endpointId, row.companyId, company?.careersUrl ?? null);
    const afterCount = await prisma.job.count({ where: { companyId: row.companyId } });
    const liveCount = await probeLiveJobCount(row.slug);
    const capturePct =
      liveCount > 0 ? Math.round((afterCount / liveCount) * 1000) / 10 : null;

    const queue = getIngestAtsEndpointQueue();
    const enqueue = await enqueueAtsEndpointIngest(queue, row.endpointId, { priority: 1 });

    report.push({
      company: row.company,
      slug: row.slug,
      endpointId: row.endpointId,
      companyId: row.companyId,
      liveJobCount: liveCount,
      jobsBefore: beforeCount,
      collapsedDeleted: deleted,
      inlineIngest: ingest,
      jobsAfter: afterCount,
      capturePct,
      enqueueAction: enqueue.action,
      verified: afterCount >= Math.min(liveCount, ingest.fetched) * 0.9,
    });

    console.log(
      `OK ${row.company}: deleted=${deleted} fetched=${ingest.fetched} inserted=${ingest.inserted} after=${afterCount} live=${liveCount}`,
    );
  }

  const out = resolve(__dir, "../../../../docs/rollout/greenhouse-ghjid-repair-report.json");
  writeFileSync(out, JSON.stringify({ repairedAt: new Date().toISOString(), report }, null, 2));
  console.log(`\nReport: ${out}`);

  await closeIngestAtsEndpointQueue();
  await prisma.$disconnect();
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
