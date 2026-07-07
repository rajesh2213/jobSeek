import type { Redis } from "ioredis";
import { logger } from "../utils/logger.js";
import {
  deleteCachedJobDetailJsonMany,
  deleteCachedJobDetailJson,
} from "../modules/job/jobDetailCache.js";

const REVALIDATE_BATCH_SIZE = Math.max(
  1,
  Number.parseInt(process.env.JOB_SEO_REVALIDATE_BATCH_SIZE ?? "25", 10) || 25,
);

const REVALIDATE_THROTTLE_SEC = Math.max(
  60,
  Number.parseInt(process.env.JOB_SEO_REVALIDATE_THROTTLE_SECONDS ?? "300", 10) || 300,
);

function revalidateThrottleKey(jobId: string): string {
  return `job:seo-revalidate-throttle:${jobId.trim()}`;
}

const REVALIDATE_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.JOB_SEO_REVALIDATE_TIMEOUT_MS ?? "8000", 10) || 8000,
);

function clientSiteOrigin(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

async function requestNextJobDetailRevalidation(jobIds: string[]): Promise<void> {
  const origin = clientSiteOrigin();
  const secret = process.env.INTERNAL_SEO_SECRET?.trim();
  if (!origin || !secret || jobIds.length === 0) return;

  const url = `${origin}/api/internal/revalidate/job`;
  for (let i = 0; i < jobIds.length; i += REVALIDATE_BATCH_SIZE) {
    const chunk = jobIds.slice(i, i + REVALIDATE_BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-seo": "true",
          "x-internal-seo-secret": secret,
        },
        body: JSON.stringify({ jobIds: chunk }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn(
          {
            event: "job_seo_revalidate_request_failed",
            status: res.status,
            count: chunk.length,
          },
          "job_seo_revalidate_request_failed",
        );
      }
    } catch (err) {
      logger.warn(
        { event: "job_seo_revalidate_request_error", count: chunk.length, err },
        "job_seo_revalidate_request_error",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Targeted Redis + Next.js ISR invalidation for job detail SEO surfaces. */
export async function invalidateJobDetailSeoCaches(
  redis: Redis,
  jobIds: string[],
): Promise<void> {
  const unique = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  await deleteCachedJobDetailJsonMany(redis, unique);
  await requestNextJobDetailRevalidationThrottled(redis, unique);
}

const SITEMAP_REVALIDATE_THROTTLE_SEC = Math.max(
  60,
  Number.parseInt(process.env.SITEMAP_REVALIDATE_THROTTLE_SECONDS ?? "120", 10) || 120,
);

function sitemapRevalidateThrottleKey(): string {
  return "seo:sitemap-revalidate-throttle";
}

async function requestNextSitemapRevalidation(): Promise<void> {
  const origin = clientSiteOrigin();
  const secret = process.env.INTERNAL_SEO_SECRET?.trim();
  if (!origin || !secret) return;

  const url = `${origin}/api/internal/revalidate/sitemap`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-seo": "true",
        "x-internal-seo-secret": secret,
      },
      body: JSON.stringify({ reason: "publishable_change" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        { event: "sitemap_revalidate_request_failed", status: res.status },
        "sitemap_revalidate_request_failed",
      );
    } else {
      logger.info({ event: "sitemap_revalidate_requested" }, "sitemap_revalidate_requested");
    }
  } catch (err) {
    logger.warn({ event: "sitemap_revalidate_request_error", err }, "sitemap_revalidate_request_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Invalidate Next.js sitemap caches when publishable set changes (throttled). */
export async function invalidateSitemapSeoCaches(redis: Redis): Promise<void> {
  const throttle = await redis.set(
    sitemapRevalidateThrottleKey(),
    "1",
    "EX",
    SITEMAP_REVALIDATE_THROTTLE_SEC,
    "NX",
  );
  if (throttle !== "OK") return;
  await requestNextSitemapRevalidation();
}

/** Read-path hook: drop stale Redis and throttle on-demand ISR for one job. */
export async function invalidateJobDetailSeoCachesOnRead(
  redis: Redis,
  jobId: string,
): Promise<void> {
  const id = jobId.trim();
  if (!id) return;
  await deleteCachedJobDetailJson(redis, id);
  await requestNextJobDetailRevalidationThrottled(redis, [id]);
}

async function requestNextJobDetailRevalidationThrottled(
  redis: Redis,
  jobIds: string[],
): Promise<void> {
  const toRevalidate: string[] = [];
  for (const id of jobIds) {
    const throttle = await redis.set(revalidateThrottleKey(id), "1", "EX", REVALIDATE_THROTTLE_SEC, "NX");
    if (throttle === "OK") toRevalidate.push(id);
  }
  await requestNextJobDetailRevalidation(toRevalidate);
}
