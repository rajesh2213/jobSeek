import type { JobService } from "../modules/job/job.service.js";
import {
  toJobDetailJson,
  toJobPublicJsonOverDailyCap,
  type JobWithCompanyRow,
} from "../modules/job/job.mapper.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { getIoredis } from "../queues/job.queue.js";
import {
  buildCapContextFromAuthorizationForwarded,
} from "../modules/viewCap/jobListCap.js";
import {
  getJobViewCapState,
  checkAndIncrementViewCap,
} from "../modules/viewCap/viewCap.service.js";
import { assertJobReadRateLimit } from "../modules/viewCap/rateLimitRedis.js";
import { recordJobBlockedNotReady } from "../services/jobStatusMetrics.service.js";
import { LIMITS } from "../config/limits.js";
import { enqueueGrowthEmailEvent } from "../modules/growthEmail/growthEmail.service.js";
import type { ApiError } from "../types/api.js";

function parseQueryBool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "1";
}

function headerFirst(
  v: string | string[] | undefined,
): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function clientIpFromForwardedHeaders(forwardedFor: string | null | undefined): string {
  const raw =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : undefined;
  return raw ?? "unknown";
}

export type JobDetailHttpParityResult =
  | { status: 429; body: ApiError }
  | { status: 404; body: ApiError }
  | { status: 200; body: Record<string, unknown> };

/**
 * Same logic as GET /jobs/:id — shared by Fastify route and Next.js SSR unified callers.
 */
export async function executeJobDetailHttpParity(args: {
  jobService: JobService;
  jobId: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): Promise<JobDetailHttpParityResult> {
  const redis = getIoredis();
  const forwardedRaw = headerFirst(args.headers["x-forwarded-for"]);
  const ip = clientIpFromForwardedHeaders(forwardedRaw ?? null);
  const rl = await assertJobReadRateLimit(redis, ip);
  if (!rl.ok) {
    return {
      status: 429,
      body: {
        error: "Too many requests",
        code: "RATE_LIMIT",
      } satisfies ApiError,
    };
  }

  const q = args.query;
  const includeProcessing = parseQueryBool(q.includeProcessing);
  const job = await args.jobService.getById(args.jobId, { includeProcessing });
  if (!job) {
    if (!includeProcessing) {
      const hidden = await args.jobService.getById(args.jobId, {
        includeProcessing: true,
      });
      if (hidden) {
        recordJobBlockedNotReady();
      }
    }
    return {
      status: 404,
      body: {
        error: "Job not found",
        code: "JOB_NOT_FOUND",
      } satisfies ApiError,
    };
  }

  const authorization = headerFirst(args.headers.authorization);
  const capCtx = await buildCapContextFromAuthorizationForwarded(
    prisma,
    authorization,
    forwardedRaw ?? null,
    undefined,
  );
  const capState = await getJobViewCapState(prisma, redis, capCtx);

  if (capState.unlimited) {
    const resetAt = capState.resetAt.toISOString();
    return {
      status: 200,
      body: {
        data: toJobDetailJson(job as unknown as JobWithCompanyRow),
        meta: {
          capReached: false,
          resetAt,
          viewCapUnlimited: true,
          limit: {
            mode: LIMITS.MODE,
            remaining: null,
            resetAt,
            warning: false,
            isCapped: false,
          },
        },
      },
    };
  }

  if (LIMITS.MODE === "hard" && capState.remaining <= 0) {
    const resetAt = capState.resetAt.toISOString();
    return {
      status: 200,
      body: {
        data: toJobPublicJsonOverDailyCap(job as unknown as JobWithCompanyRow),
        meta: {
          capReached: true,
          remaining: 0,
          resetAt,
          viewCapUnlimited: false,
          limit: {
            mode: LIMITS.MODE,
            remaining: 0,
            resetAt,
            warning: true,
            isCapped: true,
          },
        },
      },
    };
  }

  const afterCap = await checkAndIncrementViewCap(prisma, redis, capCtx, 1);

  const resetAt = afterCap.resetAt.toISOString();
  const remaining = afterCap.unlimited ? null : afterCap.remaining;
  if (capCtx.internalUserId) {
    await enqueueGrowthEmailEvent({
      userId: capCtx.internalUserId,
      email: capCtx.userEmail ?? undefined,
      campaignType: "event_followup",
      jobId: job.id,
      source: "job_detail_view",
    });
  }
  return {
    status: 200,
    body: {
      data: toJobDetailJson(job as unknown as JobWithCompanyRow),
      meta: {
        capReached: false,
        remaining,
        resetAt,
        viewCapUnlimited: Boolean(afterCap.unlimited),
        limit: {
          mode: LIMITS.MODE,
          remaining,
          resetAt,
          warning: typeof remaining === "number" && remaining <= 10,
          isCapped: typeof remaining === "number" && remaining <= 0,
        },
      },
    },
  };
}
