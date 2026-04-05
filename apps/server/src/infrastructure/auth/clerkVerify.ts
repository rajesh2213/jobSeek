import { verifyToken } from "@clerk/backend";
import type { PrismaClient } from "@prisma/client";

export type ClerkAuthContext = {
  clerkId: string;
  email: string | null;
  internalUserId: string;
};

function syntheticEmail(clerkId: string): string {
  const safe = clerkId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}@users.clerk.local`;
}

/**
 * Verifies `Authorization: Bearer <session JWT>` and upserts `User` by `clerkId`.
 */
export async function resolveClerkUser(
  prisma: PrismaClient,
  authorization: string | undefined,
): Promise<ClerkAuthContext | null> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey || !authorization?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice(7).trim();
  if (!token) return null;

  let sub: string;
  let emailRaw: string | null = null;
  try {
    const payload = await verifyToken(token, { secretKey });
    sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return null;
    const e = (payload as { email?: unknown }).email;
    emailRaw = typeof e === "string" ? e : null;
  } catch {
    return null;
  }
  const email = emailRaw?.includes("@") ? emailRaw : syntheticEmail(sub);

  const user = await prisma.user.upsert({
    where: { clerkId: sub },
    create: { clerkId: sub, email },
    update:
      emailRaw?.includes("@") && !emailRaw.endsWith("@users.clerk.local")
        ? { email: emailRaw }
        : {},
    select: { id: true },
  });

  return {
    clerkId: sub,
    email: emailRaw,
    internalUserId: user.id,
  };
}
