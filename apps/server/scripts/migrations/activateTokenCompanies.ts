/**
 * Activation pass for crawlable companies with token but no active endpoint.
 * Reuses Class B activation planner (create / relink / shared-board link / validate).
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/activateTokenCompanies.ts [--dry-run] [--limit=N] [--delay-ms=N]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import {
  ACTIVATION_TAG,
  executeActivation,
  mergeTag,
  planActivation,
  type RecoveredCompanyRow,
} from "../rollout/classBActivationLib.js";
import { fetchTokenCompaniesWithoutActiveEndpoint } from "../rollout/tokenActivationLib.js";
import {
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
  closeIngestAtsEndpointQueue,
} from "../../src/queues/ats-endpoint.queue.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 50;
const delayArg = process.argv.find((a) => a.startsWith("--delay-ms="));
const DELAY_MS = delayArg ? Number(delayArg.split("=")[1]) : 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`=== Activate Token Companies (${DRY_RUN ? "DRY RUN" : "LIVE"}) limit=${LIMIT} ===\n`);

  const companies = await fetchTokenCompaniesWithoutActiveEndpoint(prisma, LIMIT);
  const stats = {
    scanned: companies.length,
    created: 0,
    relinked: 0,
    shared: 0,
    ingestEnqueued: 0,
    skipped: 0,
    healthy: 0,
  };

  const ingestQueue = DRY_RUN ? null : getIngestAtsEndpointQueue();

  for (const row of companies) {
    const c: RecoveredCompanyRow = row;
    const plan = await planActivation(prisma, c);
    const result = await executeActivation(prisma, plan, DRY_RUN);
    let endpointId = result.endpointId;

    if (plan.action === "skip_unparseable" || plan.action === "skip_no_token") {
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
    if (result.action === "link_shared_endpoint") stats.shared++;

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
        plan.action === "link_shared_endpoint" ||
        plan.action === "validate_endpoint");

    if (needsIngest && endpointId) {
      if (!DRY_RUN) {
        const co = await prisma.company.findUnique({
          where: { id: c.id },
          select: { discoverySource: true },
        });
        await prisma.company.update({
          where: { id: c.id },
          data: {
            discoverySource: mergeTag(co?.discoverySource ?? null, `${ACTIVATION_TAG}:token_wired`),
          },
        });
        if (ingestQueue) {
          await ingestQueue.add(
            INGEST_ATS_ENDPOINT_JOB,
            { endpointId },
            { jobId: `token-activate-${endpointId}-${Date.now()}` },
          );
        }
        stats.ingestEnqueued++;
        console.log(`ENQUEUE ${c.name} ${plan.action} → ${endpointId}`);
        await sleep(DELAY_MS);
      } else {
        stats.ingestEnqueued++;
        console.log(`WOULD ENQUEUE ${c.name} ${plan.action} endpoint=${endpointId}`);
      }
    } else {
      console.log(`${DRY_RUN ? "WOULD" : "DONE"} ${c.name} ${plan.action}: ${plan.detail}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));
  await closeIngestAtsEndpointQueue().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeIngestAtsEndpointQueue().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
