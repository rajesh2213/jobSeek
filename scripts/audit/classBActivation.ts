/**
 * Class B activation dry-run — no DB writes.
 *
 * Usage:
 *   npx tsx scripts/audit/classBActivation.ts [--limit=N]
 */
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
import {
  fetchRecoveredCompanies,
  planActivation,
  type ActivationAction,
} from "../../apps/server/scripts/rollout/classBActivationLib.js";

const prisma = new PrismaClient();
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 500;

async function main(): Promise<void> {
  console.log("=== Class B Activation (DRY RUN) ===\n");

  let companies = await fetchRecoveredCompanies(prisma);
  if (LIMIT < companies.length) companies = companies.slice(0, LIMIT);

  const byAction = new Map<ActivationAction, number>();

  console.log("| Company | ATS | Action | Detail |");
  console.log("|---------|-----|--------|--------|");

  for (const c of companies) {
    const plan = await planActivation(prisma, c);
    byAction.set(plan.action, (byAction.get(plan.action) ?? 0) + 1);
    console.log(`| ${c.name} | ${c.atsType} | ${plan.action} | ${plan.detail.slice(0, 60)} |`);
  }

  console.log("\n=== Summary ===");
  console.log(`Companies: ${companies.length}`);
  console.log("By action:", Object.fromEntries(byAction));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
