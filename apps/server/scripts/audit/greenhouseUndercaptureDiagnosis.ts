/**
 * Diagnose Greenhouse under-capture for anomaly boards.
 * Run: npx tsx scripts/audit/greenhouseUndercaptureDiagnosis.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { createAtsCrawlerStandard } from "../../src/modules/ats/AtsCrawlerStandard.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";

loadRootEnv();

const __dir = dirname(fileURLToPath(import.meta.url));
const TARGETS = ["Navan", "Sendbird", "Lattice", "Wayve", "Plume", "Symphony"];

async function main() {
  const status = JSON.parse(
    readFileSync(resolve(__dir, "../../../../docs/rollout/coverage-expansion-status-check.json"), "utf8"),
  ) as {
    batches: Array<{
      rows: Array<{
        company: string;
        companyId: string;
        endpointId: string;
        slug: string;
        atsType: string;
        jobsIngested: number;
        validatedJobCount: number;
      }>;
    }>;
  };

  const rows = status.batches.flatMap((b) => b.rows).filter((r) => TARGETS.includes(r.company));
  const report: Record<string, unknown>[] = [];

  for (const row of rows) {
    const endpoint = await prisma.atsEndpoint.findUnique({
      where: { id: row.endpointId },
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

    const companyJobs = await prisma.job.findMany({
      where: { companyId: row.companyId },
      select: { id: true, title: true, sourceUrl: true, source: true, createdAt: true },
    });

    let fetchedCount = 0;
    let normalizedCount = 0;
    let fetchError: string | null = null;
    if (endpoint) {
      try {
        const standard = createAtsCrawlerStandard(endpoint.type as AtsType);
        const normalized = await standard.fetchJobs(endpoint);
        fetchedCount = normalized.length;
        normalizedCount = normalized.length;
      } catch (e) {
        fetchError = e instanceof Error ? e.message : String(e);
      }
    }

    const sourceUrls =
      endpoint && !fetchError
        ? (
            await createAtsCrawlerStandard(endpoint.type as AtsType).fetchJobs(endpoint)
          ).map((j) => j.sourceUrl)
        : [];

    const existingByUrl = sourceUrls.length
      ? await prisma.job.findMany({
          where: { sourceUrl: { in: sourceUrls } },
          select: {
            id: true,
            sourceUrl: true,
            companyId: true,
            title: true,
            source: true,
            company: { select: { name: true, domain: true } },
          },
        })
      : [];

    const urlOwnerMap = new Map<string, typeof existingByUrl>();
    for (const j of existingByUrl) {
      const list = urlOwnerMap.get(j.sourceUrl) ?? [];
      list.push(j);
      urlOwnerMap.set(j.sourceUrl, list);
    }

    const ownedByThisCompany = existingByUrl.filter((j) => j.companyId === row.companyId).length;
    const ownedByOther = existingByUrl.filter((j) => j.companyId !== row.companyId);
    const notInDb = sourceUrls.filter((u) => !urlOwnerMap.has(u));

    const otherCompanyCounts = new Map<string, number>();
    for (const j of ownedByOther) {
      const key = `${j.company?.name ?? "?"} (${j.companyId})`;
      otherCompanyCounts.set(key, (otherCompanyCounts.get(key) ?? 0) + 1);
    }

    report.push({
      company: row.company,
      slug: row.slug,
      companyId: row.companyId,
      endpointId: row.endpointId,
      validatedAtAudit: row.validatedJobCount,
      jobsUnderCompanyId: companyJobs.length,
      jobsFetchedNow: fetchedCount,
      fetchError,
      sourceUrlAnalysis: {
        totalFetchedUrls: sourceUrls.length,
        urlsWithJobRow: existingByUrl.length,
        urlsOwnedByThisCompany: ownedByThisCompany,
        urlsOwnedByOtherCompany: ownedByOther.length,
        urlsNotInDb: notInDb.length,
        otherCompanyOwners: Object.fromEntries(otherCompanyCounts),
      },
      companyJobSample: companyJobs.slice(0, 5),
      crossCompanySamples: ownedByOther.slice(0, 8).map((j) => ({
        title: j.title,
        sourceUrl: j.sourceUrl,
        ownerCompany: j.company?.name,
        ownerDomain: j.company?.domain,
        ownerCompanyId: j.companyId,
      })),
      metadata: endpoint?.metadata ?? null,
    });
  }

  const out = resolve(__dir, "../../../../docs/rollout/greenhouse-undercapture-diagnosis.json");
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
  console.log(JSON.stringify(report.map((r) => ({
    company: r.company,
    fetched: r.jobsFetchedNow,
    underCompany: r.jobsUnderCompanyId,
    crossOwned: (r.sourceUrlAnalysis as { urlsOwnedByOtherCompany: number }).urlsOwnedByOtherCompany,
    notInDb: (r.sourceUrlAnalysis as { urlsNotInDb: number }).urlsNotInDb,
    owners: (r.sourceUrlAnalysis as { otherCompanyOwners: Record<string, number> }).otherCompanyOwners,
  })), null, 2));
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
