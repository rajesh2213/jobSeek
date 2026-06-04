/**
 * Post-ingest: activate endpoints for recovered Class B companies that already have jobs.
 * Usage: cd apps/server && npx tsx scripts/migrations/activateRecoveredClassBPostIngest.ts [--dry-run]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { RECOVERED_TAG, mergeTag, ACTIVATION_TAG } from "../rollout/classBActivationLib.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ endpointId: string; companyId: string; name: string; jobCount: bigint }>
  >`
    SELECT e.id AS "endpointId", c.id AS "companyId", c.name,
           COUNT(j.id)::bigint AS "jobCount"
    FROM "Company" c
    JOIN "AtsEndpoint" e ON e."companyId" = c.id
    LEFT JOIN "Job" j ON j."companyId" = c.id AND j.status = 'ready' AND j."isActive" = true
    WHERE c."discoverySource" LIKE ${`%${RECOVERED_TAG}%`}
      AND e."isActive" = false
    GROUP BY e.id, c.id, c.name
    HAVING COUNT(j.id) > 0
  `;

  console.log(`Endpoints to activate (have jobs): ${rows.length} (${DRY_RUN ? "DRY" : "LIVE"})\n`);

  for (const r of rows) {
    const jobs = Number(r.jobCount);
    console.log(`${DRY_RUN ? "WOULD ACTIVATE" : "ACTIVATE"} ${r.name} endpoint=${r.endpointId} jobs=${jobs}`);
    if (!DRY_RUN) {
      const now = new Date();
      await prisma.atsEndpoint.update({
        where: { id: r.endpointId },
        data: {
          isActive: true,
          failureCount: 0,
          lastCheckedAt: now,
          lastSuccessAt: now,
          lastCrawledAt: now,
        },
      });
      const co = await prisma.company.findUnique({
        where: { id: r.companyId },
        select: { discoverySource: true, status: true },
      });
      await prisma.company.update({
        where: { id: r.companyId },
        data: {
          discoverySource: mergeTag(co?.discoverySource ?? null, `${ACTIVATION_TAG}:jobs_ingested`),
          ...(co?.status === "enriching" ? { status: "ready" } : {}),
        },
      });
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
