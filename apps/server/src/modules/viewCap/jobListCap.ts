import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { FastifyRequest } from "fastify";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { getJobViewCapState } from "./viewCap.service.js";
import type { PaginatedResult } from "../../types/api.js";
import { LIMITS, type CapMode } from "../../config/limits.js";
import {
  DISCOVERY_PREVIEW_ROWS,
  FREE_DISCOVERY_BONUS_ROWS,
  FREE_DISCOVERY_ROWS_PER_SEARCH,
  FREE_DISCOVERY_SEARCHES,
  getDiscoveryListState,
  incrementDiscoverySearch,
  isDiscoveryBonusFiveEnabled,
  markDiscoveryBonusUsed,
} from "./discoveryCap.js";
import { logger } from "../../utils/logger.js";

export interface CapContext {
  internalUserId: string | null;
  ip: string;
  userEmail: string | null;
}

export type DiscoveryPhase = "search" | "bonus" | "preview";

export interface MeteredJobsListMeta {
  page: number;
  /** Legacy pagination size (`limit` previously). */
  pageSize: number;
  total: number;
  totalCount: number;
  totalPages: number;
  offset: number;
  hasMore: boolean;
  capReached: boolean;
  remaining: number | null;
  resetAt: string;
  totalHidden?: number;
  viewCapUnlimited: boolean;
  /** Free-tier discovery metering (omit when Pro / bypass). */
  discoveryPhase?: DiscoveryPhase;
  discoverySearchesRemaining?: number;
  bonusBatchRemaining?: number;
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

function discoveryCtx(capCtx: CapContext) {
  return {
    internalUserId: capCtx.internalUserId,
    ip: capCtx.ip,
  };
}

function metaBase(
  result: PaginatedResult<unknown>,
  offset: number | undefined,
  _requestLimit: number,
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
  const skip =
    typeof offset === "number"
      ? offset
      : (result.page - 1) * result.limit;
  const hasMore = result.hasMore ?? skip + result.items.length < result.total;
  return {
    page: result.page,
    pageSize: result.limit,
    total: result.total,
    totalCount: result.total,
    totalPages: result.totalPages,
    offset: skip,
    hasMore,
  };
}

function bonusBatchRemaining(
  bonusOn: boolean,
  bonusSurface: "browse" | "seo",
  disc: Awaited<ReturnType<typeof getDiscoveryListState>>,
): number {
  if (!bonusOn || bonusSurface !== "seo") return 0;
  if (disc.searchesUsed < FREE_DISCOVERY_SEARCHES || disc.bonusUsed) return 0;
  return 1;
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
 * Limits are env-driven via `LIMITS.DISCOVERY`; page-1 debits when `discoveryDebit`.
 * Bonus rows apply on SEO surface when enabled and unused.
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
    /**
     * When false, page-1 does not consume a discovery search (unfiltered `/jobs` landing).
     * Company hubs should pass true so scoped lists always meter.
     */
    discoveryDebit?: boolean;
    /** Bonus 5-row batch applies only on programmatic SEO slug pages (`surface=seo`). */
    bonusSurface?: "browse" | "seo";
  },
): Promise<{ items: T[]; meta: MeteredJobsListMeta }> {
  const logMeteringCheck = (input: {
    isCapped: boolean;
    isFreeUser: boolean;
    isProUser: boolean;
    capApplied: boolean;
    limitAdjusted: boolean;
  }): void => {
    logger.info(
      {
        event: "jobs_metering_check",
        ...input,
      },
      "jobs_metering_check",
    );
  };
  const { limit, offset, fetchList } = args;
  const page = Math.max(1, args.page);
  const discoveryDebit = args.discoveryDebit !== false;
  const bonusSurface = args.bonusSurface ?? "browse";

  if (bypassCap) {
    logMeteringCheck({
      isCapped: false,
      isFreeUser: false,
      isProUser: true,
      capApplied: false,
      limitAdjusted: false,
    });
    const result = await fetchList(limit);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: false,
        remaining: null,
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
    logMeteringCheck({
      isCapped: false,
      isFreeUser: false,
      isProUser: true,
      capApplied: false,
      limitAdjusted: false,
    });
    const result = await fetchList(limit);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: false,
        remaining: null,
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

  const dctx = discoveryCtx(capCtx);
  let disc = await getDiscoveryListState(prisma, redis, dctx);
  const bonusOn =
    isDiscoveryBonusFiveEnabled() && FREE_DISCOVERY_BONUS_ROWS > 0;
  const bonusEligible = bonusOn && bonusSurface === "seo";

  const fullyExhausted =
    disc.searchesUsed >= FREE_DISCOVERY_SEARCHES &&
    (!bonusEligible || disc.bonusUsed);

  const searchesRem = Math.max(0, FREE_DISCOVERY_SEARCHES - disc.searchesUsed);
  const bonusRem = bonusBatchRemaining(bonusOn, bonusSurface, disc);

  const emptyPreviewMeta = (
    totalMatching: number,
    resetAt: Date,
  ): MeteredJobsListMeta => ({
    page,
    pageSize: limit,
    total: totalMatching,
    totalCount: totalMatching,
    totalPages: Math.ceil(totalMatching / limit) || 1,
    offset:
      typeof offset === "number"
        ? offset
        : (page - 1) * limit,
    hasMore: false,
    capReached: true,
    remaining: 0,
    resetAt: resetAt.toISOString(),
    totalHidden: Math.max(0, totalMatching - DISCOVERY_PREVIEW_ROWS),
    viewCapUnlimited: false,
    discoveryPhase: "preview",
    discoverySearchesRemaining: 0,
    bonusBatchRemaining: 0,
    limit: limitMeta({
      mode: LIMITS.MODE,
      remaining: 0,
      resetAt: resetAt.toISOString(),
    }),
  });

  const blockedPageMeta = (): MeteredJobsListMeta => ({
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
    capReached: fullyExhausted,
    remaining: fullyExhausted ? 0 : searchesRem + bonusRem,
    resetAt: disc.resetAt.toISOString(),
    viewCapUnlimited: false,
    discoveryPhase: fullyExhausted ? "preview" : "search",
    discoverySearchesRemaining: fullyExhausted ? 0 : searchesRem,
    bonusBatchRemaining: fullyExhausted ? 0 : bonusRem,
    limit: limitMeta({
      mode: LIMITS.MODE,
      remaining: fullyExhausted ? 0 : searchesRem + bonusRem,
      resetAt: disc.resetAt.toISOString(),
    }),
  });

  if (LIMITS.MODE === "soft") {
    const capAppliedSoft = page === 1 && discoveryDebit;
    if (page === 1 && discoveryDebit) {
      if (disc.searchesUsed < FREE_DISCOVERY_SEARCHES) {
        disc = await incrementDiscoverySearch(prisma, redis, dctx);
      } else if (
        bonusEligible &&
        !disc.bonusUsed &&
        disc.searchesUsed >= FREE_DISCOVERY_SEARCHES
      ) {
        await markDiscoveryBonusUsed(prisma, redis, dctx);
        disc = await getDiscoveryListState(prisma, redis, dctx);
      }
    }

    const searchesRemAfter = Math.max(0, FREE_DISCOVERY_SEARCHES - disc.searchesUsed);
    const bonusRemAfter = bonusBatchRemaining(bonusOn, bonusSurface, disc);
    const isExhaustedSoft =
      disc.searchesUsed >= FREE_DISCOVERY_SEARCHES &&
      (!bonusEligible || disc.bonusUsed);
    const result = await fetchList(limit);
    const base = metaBase(result, offset, limit);
    const remainingSoft = searchesRemAfter + bonusRemAfter;
    logMeteringCheck({
      isCapped: remainingSoft <= 0,
      isFreeUser: true,
      isProUser: false,
      capApplied: capAppliedSoft,
      limitAdjusted: false,
    });
    const phaseSoft: DiscoveryPhase = isExhaustedSoft
      ? "preview"
      : bonusEligible && disc.bonusUsed && disc.searchesUsed >= FREE_DISCOVERY_SEARCHES
        ? "bonus"
        : "search";
    return {
      items: result.items,
      meta: {
        ...base,
        capReached: remainingSoft <= 0,
        remaining: remainingSoft,
        resetAt: disc.resetAt.toISOString(),
        totalHidden: 0,
        viewCapUnlimited: false,
        discoveryPhase: phaseSoft,
        discoverySearchesRemaining: searchesRemAfter,
        bonusBatchRemaining: bonusRemAfter,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: remainingSoft,
          resetAt: disc.resetAt.toISOString(),
        }),
      },
    };
  }

  // Free tier: no extra pages beyond metered slices (blocks "Load more" pagination).
  if (fullyExhausted && page > 1) {
    logMeteringCheck({
      isCapped: true,
      isFreeUser: true,
      isProUser: false,
      capApplied: true,
      limitAdjusted: true,
    });
    return {
      items: [] as T[],
      meta: emptyPreviewMeta(0, disc.resetAt),
    };
  }

  if (fullyExhausted && page === 1) {
    const previewLimit = Math.min(limit, DISCOVERY_PREVIEW_ROWS);
    logMeteringCheck({
      isCapped: true,
      isFreeUser: true,
      isProUser: false,
      capApplied: true,
      limitAdjusted: previewLimit !== limit,
    });
    const result = await fetchList(previewLimit);
    const totalMatching = result.total;
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        hasMore: false,
        capReached: true,
        remaining: 0,
        resetAt: disc.resetAt.toISOString(),
        totalHidden: Math.max(0, totalMatching - DISCOVERY_PREVIEW_ROWS),
        viewCapUnlimited: false,
        discoveryPhase: "preview",
        discoverySearchesRemaining: 0,
        bonusBatchRemaining: 0,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: 0,
          resetAt: disc.resetAt.toISOString(),
        }),
      },
    };
  }

  if (page > 1) {
    logMeteringCheck({
      isCapped: false,
      isFreeUser: true,
      isProUser: false,
      capApplied: true,
      limitAdjusted: true,
    });
    return {
      items: [] as T[],
      meta: blockedPageMeta(),
    };
  }

  // Page 1 only below.

  if (!discoveryDebit) {
    const eff = Math.min(limit, FREE_DISCOVERY_ROWS_PER_SEARCH);
    logMeteringCheck({
      isCapped: false,
      isFreeUser: true,
      isProUser: false,
      capApplied: false,
      limitAdjusted: eff !== limit,
    });
    const result = await fetchList(eff);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        hasMore: false,
        capReached: false,
        remaining: searchesRem + bonusRem,
        resetAt: disc.resetAt.toISOString(),
        viewCapUnlimited: false,
        discoveryPhase: "search",
        discoverySearchesRemaining: searchesRem,
        bonusBatchRemaining: bonusRem,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: searchesRem + bonusRem,
          resetAt: disc.resetAt.toISOString(),
        }),
      },
    };
  }

  if (disc.searchesUsed < FREE_DISCOVERY_SEARCHES) {
    const eff = Math.min(limit, FREE_DISCOVERY_ROWS_PER_SEARCH);
    logMeteringCheck({
      isCapped: false,
      isFreeUser: true,
      isProUser: false,
      capApplied: true,
      limitAdjusted: eff !== limit,
    });
    const result = await fetchList(eff);
    disc = await incrementDiscoverySearch(prisma, redis, dctx);
    const base = metaBase(result, offset, limit);
    const searchesRemAfter = Math.max(0, FREE_DISCOVERY_SEARCHES - disc.searchesUsed);
    const bonusRemAfter = bonusBatchRemaining(bonusOn, bonusSurface, disc);
    return {
      items: result.items,
      meta: {
        ...base,
        hasMore: false,
        capReached: false,
        remaining: searchesRemAfter + bonusRemAfter,
        resetAt: disc.resetAt.toISOString(),
        viewCapUnlimited: false,
        discoveryPhase: "search",
        discoverySearchesRemaining: searchesRemAfter,
        bonusBatchRemaining: bonusRemAfter,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: searchesRemAfter + bonusRemAfter,
          resetAt: disc.resetAt.toISOString(),
        }),
      },
    };
  }

  if (bonusEligible && !disc.bonusUsed && disc.searchesUsed >= FREE_DISCOVERY_SEARCHES) {
    const eff = Math.min(limit, FREE_DISCOVERY_BONUS_ROWS);
    logMeteringCheck({
      isCapped: false,
      isFreeUser: true,
      isProUser: false,
      capApplied: true,
      limitAdjusted: eff !== limit,
    });
    const result = await fetchList(eff);
    await markDiscoveryBonusUsed(prisma, redis, dctx);
    disc = await getDiscoveryListState(prisma, redis, dctx);
    const base = metaBase(result, offset, limit);
    return {
      items: result.items,
      meta: {
        ...base,
        hasMore: false,
        capReached: false,
        remaining: 0,
        resetAt: disc.resetAt.toISOString(),
        viewCapUnlimited: false,
        discoveryPhase: "bonus",
        discoverySearchesRemaining: 0,
        bonusBatchRemaining: 0,
        limit: limitMeta({
          mode: LIMITS.MODE,
          remaining: 0,
          resetAt: disc.resetAt.toISOString(),
        }),
      },
    };
  }

  throw new Error(
    "runMeteredJobsList: unreachable discovery state — check discovery branches",
  );
}
