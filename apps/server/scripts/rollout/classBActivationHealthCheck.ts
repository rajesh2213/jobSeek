/**
 * Post-activation health check for recovered Class B cohort.
 * Usage: cd apps/server && npx tsx scripts/rollout/classBActivationHealthCheck.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { RECOVERED_TAG } from "./classBActivationLib.js";

loadRootEnv();

async function main(): Promise<void> {
  const companies = await prisma.$queryRaw<
    Array<{ id: string; name: string; status: string; atsType: string | null; atsBoardToken: string | null }>
  >`
    SELECT id, name, status::text AS status, "atsType", "atsBoardToken"
    FROM "Company"
    WHERE "discoverySource" LIKE ${`%${RECOVERED_TAG}%`}
    ORDER BY name
  `;

  const rows: Array<Record<string, unknown>> = [];
  let activeEndpoints = 0;
  let withJobs = 0;
  let ready = 0;

  for (const c of companies) {
    const endpoints = await prisma.atsEndpoint.findMany({
      where: { companyId: c.id },
      select: { id: true, type: true, slug: true, isActive: true },
    });
    const jobCount = await prisma.job.count({ where: { companyId: c.id } });
    const readyJobs = await prisma.job.count({
      where: { companyId: c.id, status: "ready", isActive: true },
    });
    const epActive = endpoints.some((e) => e.isActive);
    if (epActive) activeEndpoints++;
    if (jobCount > 0) withJobs++;
    if (c.status === "ready") ready++;

    rows.push({
      name: c.name,
      status: c.status,
      atsType: c.atsType,
      token: c.atsBoardToken?.slice(0, 40),
      endpoints: endpoints.map((e) => `${e.type}/${e.slug}${e.isActive ? " (active)" : ""}`),
      jobs: jobCount,
      readyJobs,
      healthy: epActive && readyJobs > 0,
    });
  }

  const dup = await prisma.$queryRaw<Array<{ type: string; slug: string; c: number }>>`
    SELECT type, slug, COUNT(*)::int AS c FROM "AtsEndpoint"
    GROUP BY type, slug HAVING COUNT(*) > 1
  `;

  const summary = {
    recovered: companies.length,
    withActiveEndpoint: activeEndpoints,
    withJobs,
    statusReady: ready,
    healthy: rows.filter((r) => r.healthy).length,
    duplicateTypeSlug: dup.length,
  };

  const out = {
    checkedAt: new Date().toISOString(),
    summary,
    duplicateTypeSlugRows: dup,
    companies: rows,
  };

  writeFileSync("/home/ubuntu/jobSeek/docs/rollout/class-b-activation-health.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
