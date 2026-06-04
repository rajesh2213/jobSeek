/**
 * Activate recovered Class B companies: endpoint create / link / ingest enqueue.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/activateRecoveredClassB.ts [--dry-run] [--limit=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import {
  ACTIVATION_TAG,
  executeActivation,
  fetchRecoveredCompanies,
  mergeTag,
  planActivation,
} from "../rollout/classBActivationLib.js";
import {
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
} from "../../src/queues/ats-endpoint.queue.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

async function main(): Promise<void> {
  console.log(`=== Activate Recovered Class B (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  let companies = await fetchRecoveredCompanies(prisma);
  if (LIMIT < companies.length) companies = companies.slice(0, LIMIT);

  const stats = {
    scanned: companies.length,
    created: 0,
    relinked: 0,
    validateEnqueued: 0,
    ingestEnqueued: 0,
    skipped: 0,
    healthy: 0,
  };

  const ingestQueue = DRY_RUN ? null : getIngestAtsEndpointQueue();

  for (const c of companies) {
    const plan = await planActivation(prisma, c);
    const result = await executeActivation(prisma, plan, DRY_RUN);

    let endpointId = result.endpointId;

    if (plan.action === "skip_collision" || plan.action === "skip_unparseable" || plan.action === "skip_no_token") {
      stats.skipped++;
      console.log(`SKIP ${c.name}: ${plan.detail}`);
      continue;
    }

    if (plan.action === "no_action_required") {
      stats.healthy++;
      console.log(`OK ${c.name}: ${plan.detail}`);
      continue;
    }

    if (result.action === "create_endpoint") stats.created++;
    if (result.action === "relink_endpoint") stats.relinked++;

    if (
      (plan.action === "create_endpoint" || plan.action === "relink_endpoint" || plan.action === "validate_endpoint") &&
      endpointId &&
      !DRY_RUN
    ) {
      const company = await prisma.company.findUnique({
        where: { id: c.id },
        select: { discoverySource: true },
      });
      await prisma.company.update({
        where: { id: c.id },
        data: { discoverySource: mergeTag(company?.discoverySource ?? null, `${ACTIVATION_TAG}:activated`) },
      });
    }

    if (!endpointId && plan.parsed && !DRY_RUN && plan.action === "create_endpoint") {
      const ep = await prisma.atsEndpoint.findUnique({
        where: { type_slug: { type: plan.parsed.type, slug: plan.parsed.slug } },
        select: { id: true },
      });
      endpointId = ep?.id ?? null;
    }

    const needsIngest =
      endpointId &&
      (plan.action === "create_endpoint" ||
        plan.action === "relink_endpoint" ||
        plan.action === "validate_endpoint");

    if (needsIngest && endpointId) {
      if (DRY_RUN) {
        console.log(`WOULD ENQUEUE ingest ${c.name} endpoint=${endpointId} (${plan.action})`);
        stats.ingestEnqueued++;
      } else if (ingestQueue) {
        await ingestQueue.add(
          INGEST_ATS_ENDPOINT_JOB,
          { endpointId },
          { jobId: `class-b-activate-${endpointId}-${Date.now()}` },
        );
        stats.ingestEnqueued++;
        console.log(`ENQUEUE ${c.name} ${plan.action} → ${endpointId}`);
      }
    } else {
      console.log(`${DRY_RUN ? "WOULD" : "DONE"} ${c.name} ${plan.action}: ${plan.detail}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
