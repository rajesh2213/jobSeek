/**
 * Revalidate the 6 blocked Class B cohort companies with live board probes.
 * Clears dead tokens/endpoints when board returns 404; tags outcome for audit.
 *
 * Usage:
 *   cd apps/server && npx tsx scripts/migrations/revalidateBadSlugCohort.ts [--dry-run]
 */
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import {
  mergeDiscoveryTag,
  probeBoardLive,
  reextractTokenFromCareersUrl,
} from "../rollout/boardProbe.js";

loadRootEnv();

const DRY_RUN = process.argv.includes("--dry-run");
const COHORT_NAMES = [
  "Holmusk",
  "Noibu",
  "Veho",
  "VideaHealth",
  "ResProp Management",
  "Nevados Engineering",
];

async function main(): Promise<void> {
  console.log(`=== Revalidate Bad Slug Cohort (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const companies = await prisma.company.findMany({
    where: { name: { in: COHORT_NAMES } },
    include: { atsEndpoints: { select: { id: true, type: true, slug: true, isActive: true } } },
  });

  const stats = { ok: 0, empty: 0, dead: 0, reextracted: 0, skipped: 0 };

  for (const c of companies) {
    const atsType = c.atsType?.trim();
    const token = c.atsBoardToken?.trim();
    if (!atsType || !token) {
      stats.skipped++;
      console.log(`SKIP ${c.name}: missing atsType/token`);
      continue;
    }

    let effectiveToken = token;
    let probe = await probeBoardLive(atsType, effectiveToken, c.careersUrl);

    if (probe.result === "not_found" && c.careersUrl) {
      const re = await reextractTokenFromCareersUrl(atsType, c.careersUrl);
      if (re.token && re.token !== effectiveToken) {
        const reparsed = parseCrawlableBoard(atsType as AtsType, re.token, c.careersUrl);
        if (reparsed) {
          effectiveToken = re.token;
          probe = await probeBoardLive(atsType, effectiveToken, c.careersUrl);
          console.log(`${c.name}: re-extracted token → ${effectiveToken.slice(0, 60)}`);
          stats.reextracted++;
          if (!DRY_RUN) {
            await prisma.company.update({
              where: { id: c.id },
              data: {
                atsBoardToken: effectiveToken,
                discoverySource: mergeDiscoveryTag(
                  c.discoverySource,
                  "class_b_activation:slug_reextracted",
                ),
              },
            });
          }
        }
      }
    }

    if (probe.result === "ok") {
      stats.ok++;
      console.log(`OK ${c.name} jobs=${probe.jobCount}`);
      continue;
    }

    if (probe.result === "empty") {
      stats.empty++;
      console.log(`EMPTY ${c.name}: valid board, zero jobs`);
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { id: c.id },
          data: {
            discoverySource: mergeDiscoveryTag(c.discoverySource, "class_b_activation:empty_board"),
          },
        });
        for (const ep of c.atsEndpoints) {
          await prisma.atsEndpoint.update({
            where: { id: ep.id },
            data: { isActive: false, failureCount: { increment: 1 }, lastFailureAt: new Date() },
          });
        }
      }
      continue;
    }

    stats.dead++;
    console.log(`DEAD ${c.name}: ${probe.result} (clearing token + inactive endpoints)`);
    if (!DRY_RUN) {
      await prisma.company.update({
        where: { id: c.id },
        data: {
          atsBoardToken: null,
          discoverySource: mergeDiscoveryTag(c.discoverySource, "class_b_activation:dead_board"),
        },
      });
      for (const ep of c.atsEndpoints) {
        await prisma.atsEndpoint.delete({ where: { id: ep.id } }).catch(() => {
          /* endpoint may be referenced elsewhere */
        });
        await prisma.companyAtsEndpoint.deleteMany({ where: { endpointId: ep.id } });
      }
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
