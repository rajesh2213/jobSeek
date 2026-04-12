import type { PrismaClient } from "@prisma/client";
import { devPlanOverrideForUser } from "./devPlanOverride.js";

function pickEmailForOverride(
  emailHint: string | null | undefined,
  dbEmail: string | null | undefined,
): string | null {
  if (
    emailHint &&
    emailHint.includes("@") &&
    !emailHint.endsWith("@users.clerk.local")
  ) {
    return emailHint;
  }
  if (dbEmail?.includes("@") && !dbEmail.endsWith("@users.clerk.local")) {
    return dbEmail;
  }
  return dbEmail ?? emailHint ?? null;
}

/**
 * Effective Pro/Free for API and limits. Optional `emailHint` is the Clerk JWT email when present;
 * otherwise the user's stored email is used (needed when the session token omits `email`).
 */
export async function resolveProPlan(
  prisma: PrismaClient,
  internalUserId: string,
  emailHint?: string | null,
): Promise<{ pro: boolean; plan: "free" | "pro" }> {
  const row = await prisma.user.findUnique({
    where: { id: internalUserId },
    include: { subscription: true },
  });
  if (!row) return { pro: false, plan: "free" };

  const email = pickEmailForOverride(emailHint, row.email);
  const override = devPlanOverrideForUser({ email, clerkId: row.clerkId });
  if (override === "pro") return { pro: true, plan: "pro" };
  if (override === "free") return { pro: false, plan: "free" };

  const subActive = row.subscription?.status === "active";
  const pro = row.plan === "pro" || subActive;
  return { pro, plan: pro ? "pro" : "free" };
}

export async function isUserPro(
  prisma: PrismaClient,
  internalUserId: string,
  emailHint?: string | null,
): Promise<boolean> {
  const { pro } = await resolveProPlan(prisma, internalUserId, emailHint);
  return pro;
}
