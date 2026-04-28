import { verifyToken } from "@clerk/backend";
import { TokenVerificationError, TokenVerificationErrorReason } from "@clerk/backend/errors";
import { decodeJwt, verifyJwt, type VerifyJwtOptions } from "@clerk/backend/jwt";
import type { JwtPayload } from "@clerk/types";
import type { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger.js";
import { ensureEmailPreference, enqueueGrowthEmailEvent } from "../../modules/growthEmail/growthEmail.service.js";

export type ClerkAuthContext = {
  clerkId: string;
  email: string | null;
  internalUserId: string;
};

function syntheticEmail(clerkId: string): string {
  const safe = clerkId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}@users.clerk.local`;
}

/** Node / Fastify may surface `authorization` as `string | string[] | undefined`. */
function coerceAuthorizationHeader(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((x): x is string => typeof x === "string" && x.length > 0);
    return first;
  }
  return undefined;
}

/** RFC 6757: bearer scheme is case-insensitive; require a single non-empty token. */
function extractBearerJwt(authorization: string): string | null {
  const m = authorization.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m?.[1] ?? null;
}

/**
 * Dev-only extension auth bypass.
 * Usage (local only):
 *   Authorization: Bearer dev:user_xxx
 * Enable with:
 *   DEV_EXTENSION_AUTH_BYPASS=true
 */
function devBypassClerkIdFromToken(token: string): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.DEV_EXTENSION_AUTH_BYPASS?.trim() !== "true") return null;
  const m = token.match(/^dev:(user_[A-Za-z0-9_-]+)$/);
  return m?.[1] ?? null;
}

/**
 * Session JWTs may be signed with keys published on the instance Frontend API JWKS,
 * while `verifyToken(..., { secretKey })` loads keys from the Backend API `/v1/jwks` only.
 * Those sets can differ (different `kid`), which surfaces as JWKKidMismatch.
 *
 * Fetch `iss/.well-known/jwks.json` and verify with the matching key.
 *
 * Security: only HTTPS issuers you explicitly trust, or `*.clerk.accounts.dev` (set
 * `CLERK_JWT_ISSUER=https://your-instance.clerk.accounts.dev` for custom / prod issuers).
 */
function assertTrustedJwtIssuer(iss: string): void {
  const explicit = process.env.CLERK_JWT_ISSUER?.trim().replace(/\/$/, "");
  const normalized = iss.replace(/\/$/, "");
  if (explicit) {
    if (normalized !== explicit) {
      throw new Error(`JWT iss does not match CLERK_JWT_ISSUER`);
    }
    return;
  }
  let hostname: string;
  try {
    const u = new URL(iss);
    if (u.protocol !== "https:") throw new Error("iss must be https");
    hostname = u.hostname;
  } catch {
    throw new Error("invalid iss URL");
  }
  if (!hostname.endsWith(".clerk.accounts.dev")) {
    throw new Error(
      "Untrusted JWT iss; set CLERK_JWT_ISSUER to your Clerk Frontend API origin (https://…)",
    );
  }
}

async function verifySessionTokenViaIssuerJwks(token: string): Promise<JwtPayload> {
  const jwt = decodeJwt(token);
  const iss = jwt.payload.iss;
  const kid = jwt.header.kid;
  if (typeof iss !== "string" || typeof kid !== "string" || !kid) {
    throw new Error("session JWT missing iss or kid");
  }
  assertTrustedJwtIssuer(iss);

  const jwksUrl = new URL(".well-known/jwks.json", iss.endsWith("/") ? iss : `${iss}/`);
  const res = await fetch(jwksUrl.href, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed ${res.status}`);
  }
  const body = (await res.json()) as { keys?: Array<Record<string, unknown> & { kid: string }> };
  const jwk = body.keys?.find((k) => k.kid === kid);
  if (!jwk) {
    throw new Error(`no JWK for kid=${kid} at ${jwksUrl.href}`);
  }
  // Default clockSkewInMs is 5000; small host/VM clock drift vs Clerk can exceed that and yield token-iat-in-the-future.
  return verifyJwt(token, {
    key: jwk as VerifyJwtOptions["key"],
    clockSkewInMs: 60_000,
  });
}

function payloadUser(payload: JwtPayload): { sub: string; emailRaw: string | null } | null {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return null;
  const e = (payload as { email?: unknown }).email;
  const emailRaw = typeof e === "string" ? e : null;
  return { sub, emailRaw };
}

/**
 * Verifies `Authorization: Bearer <session JWT>` and upserts `User` by `clerkId`.
 * Pass `request.headers.authorization` (may be `string | string[]` under Node).
 */
export async function resolveClerkUser(
  prisma: PrismaClient,
  authorizationHeader: unknown,
): Promise<ClerkAuthContext | null> {
  const authorization = coerceAuthorizationHeader(authorizationHeader);
  if (!authorization) return null;

  const token = extractBearerJwt(authorization);
  if (!token) return null;

  const devBypassClerkId = devBypassClerkIdFromToken(token);
  if (devBypassClerkId) {
    const email = syntheticEmail(devBypassClerkId);
    const existing = await prisma.user.findUnique({
      where: { clerkId: devBypassClerkId },
      select: { id: true },
    });
    const user = existing
      ? existing
      : await prisma.user.create({
          data: { clerkId: devBypassClerkId, email },
          select: { id: true },
        });
    await ensureEmailPreference(prisma, {
      userId: user.id,
      source: existing ? "auth_seen" : "signup_default",
      markActive: true,
    });
    if (!existing) {
      await enqueueGrowthEmailEvent({
        userId: user.id,
        email,
        campaignType: "event_welcome",
        source: "signup",
      });
    }
    logger.info(
      { event: "dev_extension_auth_bypass", clerkId: devBypassClerkId },
      "Using dev extension auth bypass",
    );
    return {
      clerkId: devBypassClerkId,
      email: null,
      internalUserId: user.id,
    };
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const jwtKey = process.env.CLERK_JWT_KEY?.trim();
  if (!secretKey && !jwtKey) return null;

  let payload: JwtPayload;
  try {
    payload = await verifyToken(token, jwtKey ? { jwtKey } : { secretKey: secretKey! });
  } catch (err) {
    const isKidMismatch =
      err instanceof TokenVerificationError && err.reason === TokenVerificationErrorReason.JWKKidMismatch;

    if (!isKidMismatch || jwtKey) {
      logger.warn(
        { err, event: "clerk_verify_failed" },
        "Clerk session JWT verification failed (check server logs / CLERK_SECRET_KEY instance match)",
      );
      return null;
    }

    try {
      payload = await verifySessionTokenViaIssuerJwks(token);
      logger.debug(
        { event: "clerk_verify_issuer_jwks_ok" },
        "Verified Clerk session JWT via Frontend API JWKS (Backend API JWKS lacked session signing key)",
      );
    } catch (fallbackErr) {
      logger.warn(
        { err: fallbackErr, cause: err, event: "clerk_verify_failed" },
        "Clerk session JWT verification failed after issuer JWKS fallback",
      );
      return null;
    }
  }

  const userFields = payloadUser(payload);
  if (!userFields) return null;
  const { sub, emailRaw } = userFields;

  const email = emailRaw?.includes("@") ? emailRaw : syntheticEmail(sub);

  const existing = await prisma.user.findUnique({
    where: { clerkId: sub },
    select: { id: true, email: true },
  });
  const user = existing
    ? await prisma.user.update({
        where: { clerkId: sub },
        data:
          emailRaw?.includes("@") && !emailRaw.endsWith("@users.clerk.local")
            ? { email: emailRaw }
            : {},
        select: { id: true, email: true },
      })
    : await prisma.user.create({
        data: { clerkId: sub, email },
        select: { id: true, email: true },
      });
  await ensureEmailPreference(prisma, {
    userId: user.id,
    source: existing ? "auth_seen" : "signup_default",
    markActive: true,
  });
  if (!existing) {
    await enqueueGrowthEmailEvent({
      userId: user.id,
      email: user.email,
      campaignType: "event_welcome",
      source: "signup",
    });
  }

  return {
    clerkId: sub,
    email: emailRaw,
    internalUserId: user.id,
  };
}
