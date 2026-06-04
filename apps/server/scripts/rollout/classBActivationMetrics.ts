/** Class B activation metrics — before/after capture. */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { buildCompanyCoverageStats } from "../../src/services/companyCoverage.service.js";

loadRootEnv();

async function main(): Promise<void> {
  const tag = process.argv[2] ?? "activation-baseline";
  const out = `/home/ubuntu/jobSeek/docs/rollout/class-b-activation-${tag}.json`;

  const [
    linkedEndpoints,
    activeEndpoints,
    orphanEndpoints,
    companiesWithAnyEndpoint,
    companiesWithActiveEndpoint,
    readyJobs,
    activeJobs,
    recoveredCount,
  ] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive" = true`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL AND "isActive" = true`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Job" WHERE status = 'ready'`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Job" WHERE status = 'ready' AND "isActive" = true`,
    prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM "Company" WHERE "discoverySource" LIKE '%class_b_token_recovery:recovered%'`,
  ]);

  const coverage = await buildCompanyCoverageStats(prisma);

  const payload = {
    capturedAt: new Date().toISOString(),
    tag,
    metrics: {
      companiesWithEndpoints: Number(companiesWithAnyEndpoint[0]?.c ?? 0),
      companiesWithActiveEndpoints: Number(companiesWithActiveEndpoint[0]?.c ?? 0),
      linkedEndpoints: Number(linkedEndpoints[0]?.c ?? 0),
      activeEndpoints: Number(activeEndpoints[0]?.c ?? 0),
      orphanEndpoints: Number(orphanEndpoints[0]?.c ?? 0),
      readyJobs: Number(readyJobs[0]?.c ?? 0),
      activeJobs: Number(activeJobs[0]?.c ?? 0),
      recoveredCompaniesTagged: Number(recoveredCount[0]?.c ?? 0),
      endpointCoveragePct: coverage.endpointCoveragePct,
      totalCompanies: coverage.totalCompanies,
    },
  };

  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.metrics, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
