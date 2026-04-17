/**
 * Non-production only: force effective plan for allowlisted users via env.
 * Set DEV_PLAN_OVERRIDE_ENABLED=true, DEV_PLAN_OVERRIDE=pro|pro_plus|free, and either
 * DEV_PLAN_OVERRIDE_EMAILS and/or DEV_PLAN_OVERRIDE_CLERK_IDS (Clerk `user_…` id).
 */
export function devPlanOverrideForUser(params: {
  email: string | null | undefined;
  clerkId: string | null | undefined;
}): "pro" | "pro_plus" | "free" | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.DEV_PLAN_OVERRIDE_ENABLED?.trim() !== "true") return null;

  const mode = process.env.DEV_PLAN_OVERRIDE?.trim().toLowerCase();
  if (mode !== "pro" && mode !== "pro_plus" && mode !== "free") return null;

  const allowEmails = (process.env.DEV_PLAN_OVERRIDE_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowClerkIds = (process.env.DEV_PLAN_OVERRIDE_CLERK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const em = params.email?.trim().toLowerCase();
  if (em?.includes("@") && !em.endsWith("@users.clerk.local") && allowEmails.includes(em)) {
    return mode as "pro" | "pro_plus" | "free";
  }

  const cid = params.clerkId?.trim();
  if (cid && allowClerkIds.includes(cid)) {
    return mode as "pro" | "pro_plus" | "free";
  }

  return null;
}
