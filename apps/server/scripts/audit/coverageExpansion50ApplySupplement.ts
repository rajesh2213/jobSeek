/**
 * Supplemental apply for 2 skipped top-50 entries (Hazel + AtoB replacement for Hightouch).
 * Run: npx tsx scripts/audit/coverageExpansion50ApplySupplement.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { createAtsEndpointService } from "../../src/modules/atsEndpoint/atsEndpoint.service.js";
import { createCompanyRepository } from "../../src/modules/company/company.repository.js";
import { linkCompanyToEndpoint } from "../../src/modules/companyEndpoint/companyEndpointLink.service.js";
import {
  closeIngestAtsEndpointQueue,
  getIngestAtsEndpointQueue,
} from "../../src/queues/ats-endpoint.queue.js";
import { enqueueAtsEndpointIngest } from "../../src/queues/atsEndpointEnqueue.js";

loadRootEnv();

const TAG = "coverage_expansion_50:supplement";

type SupplementRow = {
  company: string;
  domain: string;
  careersUrl: string;
  atsType: AtsType;
  atsToken: string;
  jobCount: number;
  existingCompanyId?: string;
  note: string;
};

const ROWS: SupplementRow[] = [
  {
    company: "Hazel",
    domain: "hazel.ai",
    careersUrl: "https://jobs.ashbyhq.com/hazel",
    atsType: "ashby",
    atsToken: "hazel",
    jobCount: 2,
    existingCompanyId: "b8553991-bb36-471f-80f5-f12e806a619e",
    note: "Existing placeholder Hazel (hazel.co) — wire validated ashby/hazel board",
  },
  {
    company: "AtoB",
    domain: "atob.com",
    careersUrl: "https://jobs.ashbyhq.com/atob",
    atsType: "ashby",
    atsToken: "atob",
    jobCount: 12,
    note: "Replacement for Hightouch (already has greenhouse/hightouch)",
  },
];

function initialEndpointScore(jobCount: number): number {
  if (jobCount >= 50) return 75;
  if (jobCount >= 20) return 60;
  if (jobCount >= 10) return 50;
  if (jobCount >= 5) return 40;
  if (jobCount >= 2) return 30;
  return 20;
}

async function main(): Promise<void> {
  const companyRepo = createCompanyRepository(prisma);
  const endpointSvc = createAtsEndpointService(prisma);
  const queue = getIngestAtsEndpointQueue();
  const results: Record<string, unknown>[] = [];

  for (const row of ROWS) {
    const parsed = parseCrawlableBoard(row.atsType, row.atsToken, row.careersUrl);
    if (!parsed) throw new Error(`unparseable: ${row.company}`);

    const existingEp = await prisma.atsEndpoint.findUnique({
      where: { type_slug: { type: parsed.type, slug: parsed.slug } },
    });
    if (existingEp) {
      results.push({ company: row.company, status: "skipped", reason: "endpoint_exists", endpointId: existingEp.id });
      continue;
    }

    let companyId = row.existingCompanyId;
    if (companyId) {
      await prisma.company.update({
        where: { id: companyId },
        data: {
          domain: row.domain,
          careersUrl: row.careersUrl,
          atsType: row.atsType,
          atsBoardToken: row.atsToken,
          discoverySource: TAG,
        },
      });
    } else {
      const company = await companyRepo.create({
        name: row.company,
        domain: row.domain,
        careersUrl: row.careersUrl,
        atsType: row.atsType,
        atsBoardToken: row.atsToken,
        discoverySource: TAG,
      });
      companyId = company.id;
    }

    const endpoint = await endpointSvc.registerEndpoint({
      type: parsed.type,
      slug: parsed.slug,
      baseUrl: parsed.baseUrl,
      crawlToken: parsed.crawlToken,
      companyName: row.company,
      companyId,
    });
    if (!endpoint) throw new Error(`register failed: ${row.company}`);

    await linkCompanyToEndpoint(prisma, {
      companyId,
      endpointId: endpoint.id,
      source: TAG,
    });

    const now = new Date();
    const score = initialEndpointScore(row.jobCount);
    await prisma.atsEndpoint.update({
      where: { id: endpoint.id },
      data: {
        isActive: true,
        score,
        successCount: 1,
        failureCount: 0,
        lastCheckedAt: now,
        lastSuccessAt: now,
        companyId,
        companyName: row.company,
      },
    });

    const enqueue = await enqueueAtsEndpointIngest(queue, endpoint.id, { priority: 1 });
    results.push({
      company: row.company,
      status: "created",
      companyId,
      endpointId: endpoint.id,
      slug: parsed.slug,
      score,
      enqueueAction: enqueue.action,
      note: row.note,
    });
    console.log(`OK ${row.company} company=${companyId} endpoint=${endpoint.id}`);
  }

  writeFileSync("/tmp/coverage-expansion-50-supplement.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await closeIngestAtsEndpointQueue();
  await prisma.$disconnect();
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
