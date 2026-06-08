/**
 * Post-ingest: activate endpoints that already have ingested jobs but remain inactive.
 * Covers recovered Class B, token_wired, and shared_board cohorts.
 *
 * Usage: cd apps/server && npx tsx scripts/migrations/activateRecoveredClassBPostIngest.ts [--dry-run]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { mergeTag, ACTIVATION_TAG } from "../rollout/classBActivationLib.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVATION_SOURCE_TAGS = [
  "class_b_token_recovery:recovered",
  "class_b_activation:token_wired",
  "class_b_activation:shared_board",
];

async function main(): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ endpointId: string; companyId: string; name: string; jobCount: bigint }>
  >`
    SELECT e.id AS "endpointId", c.id AS "companyId", c.name,
           COUNT(j.id)::bigint AS "jobCount"
    FROM "Company" c
    JOIN "AtsEndpoint" e ON e."companyId" = c.id
      OR EXISTS (SELECT 1 FROM "CompanyAtsEndpoint" l WHERE l."companyId" = c.id AND l."endpointId" = e.id)
    LEFT JOIN "Job" j ON j."companyId" = c.id AND j.status = 'ready' AND j."isActive" = true
    WHERE (
      c."discoverySource" LIKE '%class_b_token_recovery:recovered%'
      OR c."discoverySource" LIKE '%class_b_activation:token_wired%'
      OR c."discoverySource" LIKE '%class_b_activation:shared_board%'
    )
      AND e."isActive" = false
    GROUP BY e.id, c.id, c.name
    HAVING COUNT(j.id) > 0
  `;

  console.log(`Endpoints to activate (have jobs): ${rows.length} (${DRY_RUN ? "DRY" : "LIVE"})`);
  console.log(`Tags: ${ACTIVATION_SOURCE_TAGS.join(", ")}\n`);

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
