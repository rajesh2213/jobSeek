/**
 * Removes Subscription row(s) for a user and sets plan to `free`.
 * Loads repo-root `.env` (DATABASE_URL + DIRECT_DATABASE_URL).
 *
 * Usage (from apps/server): npx tsx scripts/resetUserSubscriptionByEmail.ts user@example.com
 */
import dotenv from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env"), override: true });

const emailArg = process.argv[2]?.trim();
if (!emailArg) {
  console.error("Usage: npx tsx scripts/resetUserSubscriptionByEmail.ts <email>");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({
    where: { email: { equals: emailArg, mode: "insensitive" } },
    select: { id: true, email: true, plan: true },
  });
  if (!user) {
    console.error(`No user with email: ${emailArg}`);
    process.exit(1);
  }
  const removed = await prisma.subscription.deleteMany({
    where: { userId: user.id },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { plan: "free" },
  });
  console.log(
    JSON.stringify({
      ok: true,
      email: user.email,
      priorPlan: user.plan,
      subscriptionsRemoved: removed.count,
    }),
  );
} finally {
  await prisma.$disconnect();
}
