import { createClerkClient, verifyToken } from "@clerk/backend";
import { TokenVerificationError } from "@clerk/backend/errors";
import { decodeJwt, verifyJwt, type VerifyJwtOptions } from "@clerk/backend/jwt";
import { parsePublishableKey } from "@clerk/shared/keys";
import type { JwtPayload } from "@clerk/types";
import type { PrismaClient } from "@prisma/client";
import type { FastifyReply } from "fastify";
import { logger } from "../../utils/logger.js";
import { ensureEmailPreference, enqueueGrowthEmailEvent } from "../../modules/growthEmail/growthEmail.service.js";

export type ClerkAuthContext = {
  clerkId: string;
  email: string | null;
  internalUserId: string;
};

export type ClerkAuthFailureCode =
  | "missing_authorization"
  | "missing_bearer"
  | "missing_clerk_keys"
  | "clerk_verify_failed"
  | "missing_subject";

export type ClerkAuthFailure = {
  code: ClerkAuthFailureCode;
  /** Safe to expose to trusted clients (no secrets, trimmed). */
  hint: string;
};

export type ResolveClerkUserResult =
  | { ok: true; ctx: ClerkAuthContext }
  | { ok: false; failure: ClerkAuthFailure };

/** When true, `/account/*` 401 responses include human-readable `authHint` alongside `authFailureCode`. */
export function clerkAuthHintsInApiResponses(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.JOBLOOM_AUTH_DEBUG_RESPONSES?.trim() === "true"
  );
}

/**
 * JWT `iat` vs local clock (and Clerk server skew) — default 3m; set CLERK_JWT_CLOCK_SKEW_MS for tighter control.
 * Prevents TokenIatInTheFuture when the API host clock lags Clerk or the user’s machine briefly.
 */
function clerkJwtClockSkewMs(): number {
  const raw = process.env.CLERK_JWT_CLOCK_SKEW_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 5_000 && n <= 600_000) return n;
  }
  return 180_000;
}

/** Consistent `/account/*` 401 JSON (always includes `authFailureCode` for clients). */
export function sendClerkAuthFailureReply(reply: FastifyReply, failure: ClerkAuthFailure): FastifyReply {
  void reply.header("x-jobloom-auth-failure-code", failure.code);
  if (clerkAuthHintsInApiResponses()) {
    void reply.header("x-jobloom-auth-hint", failure.hint.slice(0, 280));
  }
  const body: Record<string, unknown> = {
    error: "Unauthorized",
    code: "UNAUTHORIZED",
    authFailureCode: failure.code,
  };
  if (clerkAuthHintsInApiResponses()) {
    body.authHint = failure.hint;
  }
  return reply.status(401).send(body);
}

function syntheticEmail(clerkId: string): string {
  const safe = clerkId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}@users.clerk.local`;
}

function isSyntheticClerkLocalEmail(email: string): boolean {
  return email.endsWith("@users.clerk.local");
}

/** Real inbox address from JWT custom claims, if Clerk adds `email` to the session token. */
function realEmailFromJwt(emailRaw: string | null): string | null {
  if (emailRaw?.includes("@") && !isSyntheticClerkLocalEmail(emailRaw)) return emailRaw;
  return null;
}

const clerkPrimaryEmailCache = new Map<string, { email: string; expiresAtMs: number }>();
const CLERK_PRIMARY_EMAIL_CACHE_TTL_MS = 300_000;

/**
 * Session JWTs often omit `email`. Resolve the user's primary email via Clerk Backend API
 * (requires CLERK_SECRET_KEY). Cached briefly to avoid a Backend API call on every request.
 */
async function getPrimaryEmailFromClerkBackend(clerkUserId: string): Promise<string | null> {
  const now = Date.now();
  const hit = clerkPrimaryEmailCache.get(clerkUserId);
  if (hit && hit.expiresAtMs > now) return hit.email;

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;

  try {
    const clerk = createClerkClient({ secretKey });
    const u = await clerk.users.getUser(clerkUserId);
    const primaryId = u.primaryEmailAddressId;
    const primary =
      (primaryId ? u.emailAddresses.find((a) => a.id === primaryId) : undefined) ??
      u.emailAddresses[0];
    const addr = primary?.emailAddress?.trim();
    if (addr?.includes("@") && !isSyntheticClerkLocalEmail(addr)) {
      clerkPrimaryEmailCache.set(clerkUserId, {
        email: addr,
        expiresAtMs: now + CLERK_PRIMARY_EMAIL_CACHE_TTL_MS,
      });
      return addr;
    }
  } catch (err) {
    logger.warn(
      { err, clerkUserId, event: "clerk_backend_primary_email_failed" },
      "Clerk Backend API: could not load primary email for user",
    );
  }
  return null;
}

async function resolveEmailToPersist(
  sub: string,
  emailRaw: string | null,
  existingEmail: string | null | undefined,
): Promise<string> {
  const fromJwt = realEmailFromJwt(emailRaw);
  if (fromJwt) return fromJwt;

  const fromApi = await getPrimaryEmailFromClerkBackend(sub);
  if (fromApi) return fromApi;

  if (existingEmail && !isSyntheticClerkLocalEmail(existingEmail)) {
    return existingEmail;
  }
  return syntheticEmail(sub);
}

/** Node / Fastify may surface `authorization` as `string | string[] | undefined`. */
function coerceAuthorizationHeader(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.length > 0) {
    const s = raw.replace(/^\uFEFF/, "").trim();
    return s.length > 0 ? s : undefined;
  }
  if (Array.isArray(raw)) {
    const first = raw.find((x): x is string => typeof x === "string" && x.length > 0);
    return first ? first.replace(/^\uFEFF/, "").trim() || undefined : undefined;
  }
  return undefined;
}

/** RFC 6757: bearer scheme is case-insensitive; require a single non-empty token. */
function extractBearerJwt(authorization: string): string | null {
  const m = authorization.match(/^\s*Bearer\s+(\S+)\s*$/i);
  const raw = m?.[1];
  if (raw === undefined) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
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
/** JWT `iss` hostname must match the Frontend API host embedded in your Clerk publishable key. */
function issuerMatchesPublishableKeyFromEnv(iss: string): boolean {
  const pkRaw =
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!pkRaw) return false;
  try {
    const pk = parsePublishableKey(pkRaw, { fatal: true });
    const hostname = new URL(iss).hostname;
    return hostname === pk.frontendApi;
  } catch {
    return false;
  }
}

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
    const protoOk =
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]"));
    if (!protoOk) throw new Error("iss must be https (or http loopback)");
    hostname = u.hostname;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("iss must")) throw e;
    throw new Error("invalid iss URL");
  }
  if (hostname.endsWith(".clerk.accounts.dev")) return;
  if (issuerMatchesPublishableKeyFromEnv(iss)) return;
  throw new Error(
    "Untrusted JWT iss; set CLERK_JWT_ISSUER to your Clerk Frontend API origin (https://…), or put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_PUBLISHABLE_KEY in repo .env",
  );
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
  let lastJwksErr: unknown;
  let jwk: (Record<string, unknown> & { kid: string }) | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(jwksUrl.href, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new Error(`JWKS fetch failed ${res.status}`);
      }
      const body = (await res.json()) as { keys?: Array<Record<string, unknown> & { kid: string }> };
      const found = body.keys?.find((k) => k.kid === kid);
      if (!found) {
        throw new Error(`no JWK for kid=${kid} at ${jwksUrl.href}`);
      }
      jwk = found;
      break;
    } catch (e) {
      lastJwksErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!jwk) throw lastJwksErr instanceof Error ? lastJwksErr : new Error(String(lastJwksErr));

  return verifyJwt(token, {
    key: jwk as VerifyJwtOptions["key"],
    clockSkewInMs: clerkJwtClockSkewMs(),
  });
}

function payloadUser(payload: JwtPayload): { sub: string; emailRaw: string | null } | null {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return null;
  const e = (payload as { email?: unknown }).email;
  const emailRaw = typeof e === "string" ? e : null;
  return { sub, emailRaw };
}

function normalizeAuthorizedPartyOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/** Clerk `azp` may be http or https; env files usually declare one scheme. */
function expandHttpHttpsForOrigins(origins: string[]): string[] {
  const out = new Set(origins.map(normalizeAuthorizedPartyOrigin).filter(Boolean));
  for (const o of [...out]) {
    if (o.startsWith("http://")) out.add(o.replace(/^http:\/\//, "https://"));
    else if (o.startsWith("https://")) out.add(o.replace(/^https:\/\//, "http://"));
  }
  return [...out];
}

function safeErrorMessage(err: unknown, max = 220): string {
  if (err instanceof Error) return err.message.slice(0, max);
  return String(err).slice(0, max);
}

function clerkVerifyFailureHint(issuerErr: unknown, verifyErr: unknown, azpEnforced: boolean): string {
  const bits = [
    `NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`,
    `azp_enforced=${azpEnforced}`,
    `issuer_step=${safeErrorMessage(issuerErr, 160)}`,
  ];
  if (verifyErr instanceof TokenVerificationError) {
    bits.push(`verifyToken=${verifyErr.reason}${verifyErr.message ? `: ${verifyErr.message.slice(0, 140)}` : ""}`);
  } else {
    bits.push(`verifyToken=${safeErrorMessage(verifyErr, 160)}`);
  }
  return bits.join(" | ");
}

/**
 * Clerk compares session `azp` with strict equality to entries in `authorizedParties`.
 * Include both trailing-slash variants so env URLs still match Browser Clerk origins.
 */
function expandAuthorizedPartiesForClerkSdk(parties: string[]): string[] {
  const out = new Set<string>();
  for (const raw of parties) {
    const base = normalizeAuthorizedPartyOrigin(raw);
    if (!base) continue;
    out.add(base);
    out.add(`${base}/`);
  }
  return [...out];
}

/** Same rule as Clerk when `authorizedParties` is unset: skip check. */
function assertAzpMatchesAuthorizedParties(jwtPayload: JwtPayload, parties: string[] | undefined): void {
  if (!parties?.length) return;
  const azpRaw = (jwtPayload as { azp?: unknown }).azp;
  const azp = typeof azpRaw === "string" ? normalizeAuthorizedPartyOrigin(azpRaw) : "";
  const normalizedParties = parties.map(normalizeAuthorizedPartyOrigin);
  if (!azp || !normalizedParties.includes(azp)) {
    throw new Error("JWT azp not in authorizedParties");
  }
}

/**
 * Clerk session JWTs include `azp` (authorized party). `verifyToken` must receive matching
 * origins or verification fails with a valid secret key (common pitfall for extension /
 * Bearer tokens from Next.js on localhost:3001).
 *
 * @see https://clerk.com/docs/reference/backend/verify-token
 */
function clerkAuthorizedParties(): string[] | undefined {
  const csv = process.env.CLERK_AUTHORIZED_PARTIES?.trim();
  const fromCsv = csv
    ? csv
        .split(",")
        .map((s) => normalizeAuthorizedPartyOrigin(s))
        .filter(Boolean)
    : [];
  const fromUrls = [
    process.env.CLIENT_URL?.trim(),
    process.env.NEXT_PUBLIC_SITE_URL?.trim(),
  ]
    .map((x) => (x ? normalizeAuthorizedPartyOrigin(x) : ""))
    .filter(Boolean);
  const merged = [...new Set([...fromCsv, ...fromUrls])];

  if (process.env.NODE_ENV === "production") {
    return merged.length ? expandHttpHttpsForOrigins(merged) : undefined;
  }

  /**
   * Session JWT `azp` equals the browser origin. Dev commonly mixes `localhost` vs `127.0.0.1`
   * (and IPv6 loopback); `.env` often lists only one canonical URL (e.g. NEXT_PUBLIC_SITE_URL),
   * which would reject the other unless we always allow this loopback set locally.
   */
  const devLoopbackParties = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://[::1]:3000",
    "http://[::1]:3001",
  ];
  return expandHttpHttpsForOrigins([...new Set([...merged, ...devLoopbackParties])]);
}

async function upsertUserFromClerkPayload(
  prisma: PrismaClient,
  payload: JwtPayload,
): Promise<ClerkAuthContext | null> {
  const userFields = payloadUser(payload);
  if (!userFields) return null;
  const { sub, emailRaw } = userFields;

  const existing = await prisma.user.findUnique({
    where: { clerkId: sub },
    select: { id: true, email: true },
  });
  const emailToPersist = await resolveEmailToPersist(sub, emailRaw, existing?.email);

  const user = existing
    ? await prisma.user.update({
        where: { clerkId: sub },
        data: emailToPersist !== existing.email ? { email: emailToPersist } : {},
        select: { id: true, email: true },
      })
    : await prisma.user.create({
        data: { clerkId: sub, email: emailToPersist },
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

  const ctxEmail =
    realEmailFromJwt(emailRaw) ??
    (!isSyntheticClerkLocalEmail(user.email) ? user.email : null);

  return {
    clerkId: sub,
    email: ctxEmail,
    internalUserId: user.id,
  };
}

/**
 * Verifies `Authorization: Bearer <session JWT>` and upserts `User` by `clerkId`.
 * Pass `request.headers.authorization` (may be `string | string[]` under Node).
 */
export async function resolveClerkUserResult(
  prisma: PrismaClient,
  authorizationHeader: unknown,
): Promise<ResolveClerkUserResult> {
  const authorization = coerceAuthorizationHeader(authorizationHeader);
  if (!authorization) {
    return {
      ok: false,
      failure: {
        code: "missing_authorization",
        hint: "No Authorization header was sent.",
      },
    };
  }

  const token = extractBearerJwt(authorization);
  if (!token) {
    return {
      ok: false,
      failure: {
        code: "missing_bearer",
        hint: "Authorization must be exactly `Bearer <Clerk session JWT>`.",
      },
    };
  }

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
    return {
      ok: true,
      ctx: {
        clerkId: devBypassClerkId,
        email: null,
        internalUserId: user.id,
      },
    };
  }

  /**
   * `authorizedParties` / `azp` matching is strict in `@clerk/backend` (exact string includes).
   * Local dev uses many origins (http/https, ports, tunnel hosts, Clerk dashboard changes).
   * We only enforce the allowlist when `NODE_ENV=production` (override with JOBLOOM_RELAX_CLERK_AZP=true).
   */
  const enforceAuthorizedParties =
    process.env.NODE_ENV === "production" &&
    process.env.JOBLOOM_RELAX_CLERK_AZP?.trim() !== "true";

  const jwtKeyForVerifyTokenOptions = process.env.CLERK_JWT_KEY?.trim();
  const authorizedParties = enforceAuthorizedParties ? clerkAuthorizedParties() : undefined;
  const verifyTokenParties =
    authorizedParties?.length && !jwtKeyForVerifyTokenOptions
      ? expandAuthorizedPartiesForClerkSdk(authorizedParties)
      : authorizedParties;

  let payload: JwtPayload | undefined;
  let issuerAttemptError: unknown;

  try {
    const fromIssuer = await verifySessionTokenViaIssuerJwks(token);
    if (enforceAuthorizedParties) {
      assertAzpMatchesAuthorizedParties(fromIssuer, authorizedParties);
    }
    payload = fromIssuer;
  } catch (err) {
    issuerAttemptError = err;
  }

  if (!payload) {
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    const jwtKey = jwtKeyForVerifyTokenOptions;
    if (!secretKey && !jwtKey) {
      logger.warn(
        { err: issuerAttemptError, event: "clerk_verify_failed" },
        "Clerk session JWT verification failed (issuer JWKS failed and CLERK_SECRET_KEY / CLERK_JWT_KEY missing)",
      );
      return {
        ok: false,
        failure: {
          code: "missing_clerk_keys",
          hint: `${safeErrorMessage(issuerAttemptError)} — add CLERK_SECRET_KEY (or CLERK_JWT_KEY) to repo .env.`,
        },
      };
    }
    try {
      payload = await verifyToken(token, {
        ...(jwtKey ? { jwtKey } : { secretKey: secretKey! }),
        clockSkewInMs: clerkJwtClockSkewMs(),
        ...(verifyTokenParties?.length ? { authorizedParties: verifyTokenParties } : {}),
      });
    } catch (verifyErr) {
      logger.warn(
        {
          err: verifyErr,
          issuerErr: issuerAttemptError,
          event: "clerk_verify_failed",
          enforceAuthorizedParties,
          nodeEnv: process.env.NODE_ENV ?? "(unset)",
        },
        "Clerk session JWT verification failed (issuer JWKS and verifyToken both rejected the token)",
      );
      return {
        ok: false,
        failure: {
          code: "clerk_verify_failed",
          hint: clerkVerifyFailureHint(issuerAttemptError, verifyErr, enforceAuthorizedParties),
        },
      };
    }
  }

  const ctx = await upsertUserFromClerkPayload(prisma, payload);
  if (!ctx) {
    return {
      ok: false,
      failure: {
        code: "missing_subject",
        hint:
          "JWT signature verified but there is no usable `sub` (Clerk user id). Token may not be a Clerk session JWT.",
      },
    };
  }
  return { ok: true, ctx };
}

export async function resolveClerkUser(
  prisma: PrismaClient,
  authorizationHeader: unknown,
): Promise<ClerkAuthContext | null> {
  const r = await resolveClerkUserResult(prisma, authorizationHeader);
  return r.ok ? r.ctx : null;
}
