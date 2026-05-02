import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { FastifyRequest } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { checkAndIncrementViewCap, getJobViewCapState } from "./viewCap.service.js";
import type { PaginatedResult } from "../../types/api.js";
import { LIMITS, type CapMode } from "../../config/limits.js";
import { DISCOVERY_PREVIEW_ROWS } from "./discoveryCap.js";

export interface CapContext {
  internalUserId: string | null;
  ip: string;
  userEmail: string | null;
}

export type DiscoveryPhase = "search" | "preview";

export interface MeteredJobsListMeta {
  page: number;
  /** Legacy pagination size (`limit` previously). */
  pageSize: number;
  total: number | null;
  totalCount: number | null;
  totalPages?: number;
  offset: number;
  hasMore: boolean;
  capReached: boolean;
  remaining: number | null;
  /** Number of rows debited by this request (server-authoritative). */
  debitedCount?: number;
  /** Remaining balance before this request was applied. */
  remainingBefore?: number | null;
  /** Remaining balance after this request was applied. */
  remainingAfter?: number | null;
  resetAt: string;
  totalHidden?: number;
  viewCapUnlimited: boolean;
  /** Free-tier discovery metering (omit when Pro / bypass). */
  discoveryPhase?: DiscoveryPhase;
  limit: {
    mode: CapMode;
    remaining: number | null;
    resetAt: string;
    warning: boolean;
    isCapped: boolean;
  };
}

export function isViewCapBypassRequest(request: FastifyRequest): boolean {
  const q = request.query as Record<string, unknown>;
  const utmSource = typeof q?.utm_source === "string" ? q.utm_source.toLowerCase() : "";
  const emailClick = utmSource === "email";
  if (emailClick) {
    return true;
  }

  const internalMarker = request.headers["x-internal-seo"];
  const internalSecret = request.headers["x-internal-seo-secret"];
  const expectedInternalSecret = process.env.INTERNAL_SEO_SECRET?.trim();
  if (
    internalMarker === "true" &&
    typeof internalSecret === "string" &&
    Boolean(expectedInternalSecret) &&
    internalSecret === expectedInternalSecret
  ) {
    return true;
  }

  // Backward-compatible bypass token support (deprecated).
  const bypassToken = process.env.JOB_LIST_VIEW_CAP_BYPASS_TOKEN?.trim();
  const bypassHeader = request.headers["x-jobseek-view-cap-bypass"];
  return (
    Boolean(bypassToken) &&
    typeof bypassHeader === "string" &&
    bypassHeader === bypassToken
  );
}

export function clientIp(request: FastifyRequest): string {
  const xff = request.headers["x-forwarded-for"];
  const raw =
    typeof xff === "string"
      ? xff.split(",")[0]?.trim()
      : Array.isArray(xff)
        ? xff[0]
        : undefined;
  return raw || request.ip || request.socket.remoteAddress || "unknown";
}

export async function buildCapContextFromRequest(
  prisma: PrismaClient,
  request: FastifyRequest,
): Promise<CapContext> {
  const clerk = await resolveClerkUser(prisma, request.headers.authorization);
  return {
    internalUserId: clerk?.internalUserId ?? null,
    ip: clientIp(request),
    userEmail: clerk?.email ?? null,
  };
}

function metaBase(
  result: PaginatedResult<unknown>,
  offset: number | undefined,
  /** Nominal page size from the client/query (`meteredLimit`), not the clamped fetch limit. */
  paginationStride: number,
): Pick<
  MeteredJobsListMeta,
  | "page"
  | "pageSize"
  | "total"
  | "totalCount"
  | "totalPages"
  | "offset"
  | "hasMore"
> {
  const stride =
    paginationStride > 0 ? paginationStride : Math.max(1, result.limit);
  const skip =
    typeof offset === "number"
      ? offset
      : (result.page - 1) * stride;
  const hasMore =
    result.hasMore ??
    (typeof result.total === "number"
      ? result.page * stride < result.total
      : result.items.length === stride);
  return {
    page: result.page,
    pageSize: stride,
    total: result.total,
    totalCount: result.total,
    totalPages: result.totalPages,
    offset: skip,
    hasMore,
  };
}

function limitMeta(input: {
  mode: CapMode;
  remaining: number | null;
  resetAt: string;
}): MeteredJobsListMeta["limit"] {
  const remaining = input.remaining;
  return {
    mode: input.mode,
    remaining,
    resetAt: input.resetAt,
    warning: typeof remaining === "number" && remaining <= 10,
    isCapped: typeof remaining === "number" && remaining <= 0,
  };
}

/**
 * Shared metering for any paginated job list (discovery `/jobs`, company-scoped lists, etc.).
 * Free tier uses a single UTC-daily row budget (`FREE_TIER_DAILY_LIMIT`) across all list pages.
 * After exhaustion in hard mode: page 1 returns preview rows, page 2+ is blocked.
 */
export async function runMeteredJobsList<T>(
  prisma: PrismaClient,
  redis: Redis,
  capCtx: CapContext,
  bypassCap: boolean,
  args: {
    limit: number;
    offset?: number;
    page: number;
    fetchList: (effectiveLimit: number) => Promise<PaginatedResult<T>>;
  },
): Promise<{ items: T[]; meta: MeteredJobsListMeta }> {
  const { limit, offset, fetchList } = args;
  const page = Math.max(1, args.page);

  if (bypassCap) {
    const result = await fetchList(limit);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: false,
        remaining: null,
        debitedCount: 0,
        remainingBefore: null,
        remainingAfter: null,
        resetAt: new Date().toISOString(),
        viewCapUnlimited: true,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: null,
          resetAt: new Date().toISOString(),
        }),
      },
    };
  }

  const capState = await getJobViewCapState(prisma, redis, capCtx);
  if (capState.unlimited) {
    const result = await fetchList(limit);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: false,
        remaining: null,
        debitedCount: 0,
        remainingBefore: null,
        remainingAfter: null,
        resetAt: capState.resetAt.toISOString(),
        viewCapUnlimited: true,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: null,
          resetAt: capState.resetAt.toISOString(),
        }),
      },
    };
  }

  const blockedPageMeta = (remaining: number): MeteredJobsListMeta => ({
    page,
    pageSize: limit,
    total: 0,
    totalCount: 0,
    totalPages: 1,
    offset:
      typeof offset === "number"
        ? offset
        : (page - 1) * limit,
    hasMore: false,
    capReached: remaining <= 0,
    remaining: Math.max(0, remaining),
    debitedCount: 0,
    remainingBefore: Math.max(0, remaining),
    remainingAfter: Math.max(0, remaining),
    resetAt: capState.resetAt.toISOString(),
    viewCapUnlimited: false,
    discoveryPhase: remaining <= 0 ? "preview" : "search",
    limit: limitMeta({
      mode: LIMITS.MODE,
      remaining: Math.max(0, remaining),
      resetAt: capState.resetAt.toISOString(),
    }),
  });

  /** Hard mode: capped mid-pagination — do not use preview phase (page-1 teaser only). */
  const blockedDeepPaginationMeta = (resetAtIso: string): MeteredJobsListMeta => ({
    page,
    pageSize: limit,
    total: null,
    totalCount: null,
    totalPages: undefined,
    offset:
      typeof offset === "number"
        ? offset
        : (page - 1) * limit,
    hasMore: false,
    capReached: true,
    remaining: 0,
    debitedCount: 0,
    remainingBefore: 0,
    remainingAfter: 0,
    resetAt: resetAtIso,
    viewCapUnlimited: false,
    discoveryPhase: "search",
    limit: limitMeta({
      mode: LIMITS.MODE,
      remaining: 0,
      resetAt: resetAtIso,
    }),
  });

  if (LIMITS.MODE === "soft") {
    if (capState.remaining <= 0 && page > 1) {
      return {
        items: [] as T[],
        meta: blockedDeepPaginationMeta(capState.resetAt.toISOString()),
      };
    }
    const fetchCap =
      capState.remaining <= 0 ? limit : Math.min(limit, Math.max(0, capState.remaining));
    const result = await fetchList(fetchCap);
    const debit = await checkAndIncrementViewCap(prisma, redis, capCtx, result.items.length);
    const base = metaBase(result, offset, limit);
    const remainingSoft = Math.max(0, debit.remaining);
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: remainingSoft <= 0,
        remaining: remainingSoft,
        debitedCount: result.items.length,
        remainingBefore: capState.remaining,
        remainingAfter: remainingSoft,
        resetAt: debit.resetAt.toISOString(),
        totalHidden: 0,
        viewCapUnlimited: false,
        discoveryPhase: "search",
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: remainingSoft,
          resetAt: debit.resetAt.toISOString(),
        }),
      },
    };
  }

  // Hard mode: after exhaustion, block page 2+ without switching to preview-phase UX.
  if (capState.remaining <= 0 && page > 1) {
    return {
      items: [] as T[],
      meta: blockedDeepPaginationMeta(capState.resetAt.toISOString()),
    };
  }

  // Hard mode: after exhaustion, keep page 1 preview.
  if (capState.remaining <= 0 && page === 1) {
    const previewLimit = Math.min(limit, DISCOVERY_PREVIEW_ROWS);
    const result = await fetchList(previewLimit);
    const totalMatching = result.total ?? result.items.length;
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        hasMore: false,
        capReached: true,
        remaining: 0,
        debitedCount: 0,
        remainingBefore: 0,
        remainingAfter: 0,
        resetAt: capState.resetAt.toISOString(),
        totalHidden: Math.max(0, totalMatching - DISCOVERY_PREVIEW_ROWS),
        viewCapUnlimited: false,
        discoveryPhase: "preview",
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: 0,
          resetAt: capState.resetAt.toISOString(),
        }),
      },
    };
  }

  // Hard mode + remaining budget: every returned row decrements the same daily pool.
  const effectiveLimit = Math.min(limit, Math.max(0, capState.remaining));
  if (effectiveLimit <= 0) {
    return { items: [] as T[], meta: blockedPageMeta(0) };
  }

  const result = await fetchList(effectiveLimit);
  const debit = await checkAndIncrementViewCap(prisma, redis, capCtx, result.items.length);
  const remainingAfter = Math.max(0, debit.remaining);
  const base = metaBase(result, offset, limit);
  return {
    items: result.items,
    meta: {
      ...base,
      capReached: remainingAfter <= 0,
      remaining: remainingAfter,
      debitedCount: result.items.length,
      remainingBefore: capState.remaining,
      remainingAfter,
      resetAt: debit.resetAt.toISOString(),
      viewCapUnlimited: false,
      discoveryPhase: "search",
      limit: limitMeta({
        mode: LIMITS.MODE,
        remaining: remainingAfter,
        resetAt: debit.resetAt.toISOString(),
      }),
    },
  };
}
