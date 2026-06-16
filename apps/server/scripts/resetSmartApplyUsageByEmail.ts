/**
 * Reset Smart Apply daily usage for one user (smartApplyJobsToday → 0).
 * Loads repo-root `.env` (DATABASE_URL).
 *
 * Usage (from apps/server):
 *   npx tsx scripts/resetSmartApplyUsageByEmail.ts user@example.com --dry-run
 *   ALLOW_PROD_RESET=true npx tsx scripts/resetSmartApplyUsageByEmail.ts user@example.com --confirm
 */
import dotenv from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env"), override: true });

const emailArg = process.argv[2]?.trim();
const flags = new Set(process.argv.slice(3));
const dryRun = flags.has("--dry-run") || !flags.has("--confirm");

if (!emailArg) {
  console.error(
    "Usage: npx tsx scripts/resetSmartApplyUsageByEmail.ts <email> [--dry-run | --confirm]",
  );
  process.exit(1);
}

if (!dryRun && process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RESET !== "true") {
  console.error(
    "Refusing production reset without ALLOW_PROD_RESET=true. Re-run with --dry-run to inspect first.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.findFirst({
    where: { email: { equals: emailArg, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      plan: true,
      smartApplyJobsToday: true,
      smartApplyResetAt: true,
    },
  });

  if (!user) {
    console.error(`No user with email: ${emailArg}`);
    process.exit(1);
  }

  const snapshot = {
    email: user.email,
    userId: user.id,
    plan: user.plan,
    smartApplyJobsToday: user.smartApplyJobsToday,
    smartApplyResetAt: user.smartApplyResetAt.toISOString(),
    dryRun,
  };

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, action: "dry_run", ...snapshot }, null, 2));
    process.exit(0);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      smartApplyJobsToday: 0,
      smartApplyResetAt: new Date(),
    },
    select: {
      email: true,
      plan: true,
      smartApplyJobsToday: true,
      smartApplyResetAt: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "reset",
        before: snapshot,
        after: {
          email: updated.email,
          plan: updated.plan,
          smartApplyJobsToday: updated.smartApplyJobsToday,
          smartApplyResetAt: updated.smartApplyResetAt.toISOString(),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
