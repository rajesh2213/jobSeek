/**
 * Phases 7–8: Create 50 approved endpoints and queue ingestion.
 * Run: npx tsx scripts/audit/coverageExpansion50Apply.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

const TAG = "coverage_expansion_50:approved";
const __dir = dirname(fileURLToPath(import.meta.url));
const AUDIT_PATH = resolve(__dir, "../../../../docs/rollout/coverage-expansion-50-audit.json");

type AuditRow = {
  company: string;
  domain: string;
  careersUrl: string;
  category: string;
  atsType: string;
  atsToken: string;
  endpointUrl: string;
  slug: string;
  jobCount: number;
  score: number;
};

type ApplyResult = {
  company: string;
  domain: string;
  atsType: string;
  slug: string;
  status: "created" | "skipped_existing" | "failed";
  companyId?: string;
  endpointId?: string;
  linkId?: string;
  enqueueAction?: string;
  error?: string;
};

function normDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, "").trim();
}

function initialEndpointScore(jobCount: number): number {
  if (jobCount >= 50) return 75;
  if (jobCount >= 20) return 60;
  if (jobCount >= 10) return 50;
  if (jobCount >= 5) return 40;
  if (jobCount >= 2) return 30;
  return 20;
}

async function existsCheck(row: AuditRow): Promise<string | null> {
  const domain = normDomain(row.domain);
  const slugKey = { type: row.atsType, slug: row.slug.toLowerCase() };

  const [byDomain, byName, bySlug] = await Promise.all([
    prisma.company.findFirst({ where: { domain }, select: { id: true } }),
    prisma.company.findFirst({
      where: { name: { equals: row.company, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.atsEndpoint.findUnique({
      where: { type_slug: slugKey },
      select: { id: true },
    }),
  ]);

  if (byDomain) return "company_domain_exists";
  if (byName) return "company_name_exists";
  if (bySlug) return "endpoint_slug_exists";
  return null;
}

async function main(): Promise<void> {
  const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as { top50: AuditRow[] };
  const rows = audit.top50;
  if (rows.length !== 50) {
    throw new Error(`Expected 50 approved rows, got ${rows.length}`);
  }

  const companyRepo = createCompanyRepository(prisma);
  const endpointSvc = createAtsEndpointService(prisma);
  const queue = getIngestAtsEndpointQueue();

  const results: ApplyResult[] = [];
  const stats = { created: 0, skipped: 0, failed: 0, enqueued: 0 };

  console.log(`=== Coverage Expansion 50 Apply (LIVE) ===\n`);

  for (const row of rows) {
    const base: ApplyResult = {
      company: row.company,
      domain: row.domain,
      atsType: row.atsType,
      slug: row.slug,
      status: "failed",
    };

    try {
      const reject = await existsCheck(row);
      if (reject) {
        stats.skipped++;
        results.push({ ...base, status: "skipped_existing", error: reject });
        console.log(`SKIP ${row.company}: ${reject}`);
        continue;
      }

      const parsed = parseCrawlableBoard(row.atsType as AtsType, row.atsToken, row.careersUrl);
      if (!parsed) {
        stats.failed++;
        results.push({ ...base, status: "failed", error: "parseCrawlableBoard failed" });
        console.log(`FAIL ${row.company}: unparseable`);
        continue;
      }

      const company = await companyRepo.create({
        name: row.company,
        domain: row.domain,
        careersUrl: row.careersUrl,
        atsType: row.atsType,
        atsBoardToken: row.atsToken,
        discoverySource: TAG,
      });

      const endpoint = await endpointSvc.registerEndpoint({
        type: parsed.type,
        slug: parsed.slug,
        baseUrl: parsed.baseUrl,
        crawlToken: parsed.crawlToken,
        companyName: row.company,
        companyId: company.id,
      });

      if (!endpoint) {
        stats.failed++;
        results.push({ ...base, status: "failed", companyId: company.id, error: "registerEndpoint returned null" });
        console.log(`FAIL ${row.company}: registerEndpoint null`);
        continue;
      }

      const link = await linkCompanyToEndpoint(prisma, {
        companyId: company.id,
        endpointId: endpoint.id,
        source: TAG,
      });

      const epScore = initialEndpointScore(row.jobCount);
      const now = new Date();
      await prisma.atsEndpoint.update({
        where: { id: endpoint.id },
        data: {
          isActive: true,
          score: epScore,
          successCount: 1,
          failureCount: 0,
          lastCheckedAt: now,
          lastSuccessAt: now,
          source: "enrichment",
          companyId: company.id,
          companyName: row.company,
        },
      });

      const enqueue = await enqueueAtsEndpointIngest(queue, endpoint.id, { priority: 1 });
      if (enqueue.action === "enqueued" || enqueue.action === "reclaimed_failed") {
        stats.enqueued++;
      }

      stats.created++;
      results.push({
        ...base,
        status: "created",
        companyId: company.id,
        endpointId: endpoint.id,
        linkId: link.linked ? endpoint.id : undefined,
        enqueueAction: enqueue.action,
      });
      console.log(
        `OK ${row.company} company=${company.id} endpoint=${endpoint.id} score=${epScore} enqueue=${enqueue.action}`,
      );
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ...base, status: "failed", error: msg });
      console.log(`FAIL ${row.company}: ${msg}`);
    }
  }

  const out = {
    appliedAt: new Date().toISOString(),
    tag: TAG,
    stats,
    results,
  };

  const outPath = "/tmp/coverage-expansion-50-apply.json";
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n=== Apply Summary ===`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`Report: ${outPath}`);

  await closeIngestAtsEndpointQueue();
  await prisma.$disconnect();
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
