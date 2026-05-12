import { getIoredis } from "../queues/job.queue.js";
import { logger } from "../utils/logger.js";
import { normalizeJobUrl } from "../utils/normalizeJobUrl.js";

/** Default: 24h so repeated crawls re-skip the same listing within a day. */
const DEFAULT_RECENT_SEEN_TTL_SEC = 24 * 60 * 60;
const RECENT_SEEN_TTL_SEC = Math.max(
  60,
  Number(process.env.PROCESS_JOB_RECENT_SEEN_TTL_SEC ?? "86400") || DEFAULT_RECENT_SEEN_TTL_SEC,
);

function recentSeenKey(sourceUrl: string): string {
  return `job:seen:${sourceUrl}`;
}

/**
 * Read-only: true if the crawl enqueue dedupe key exists (another path recently claimed this URL).
 * Does **not** mutate Redis. Used for OpenClaw shadow parse eligibility only.
 */
export async function peekRecentSeenBlocksEnqueue(sourceUrl: string): Promise<boolean> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return false;
  const normalizedUrl = normalizeJobUrl(trimmed);
  try {
    const redis = getIoredis();
    const key = recentSeenKey(normalizedUrl);
    const v = await redis.get(key);
    return v != null && v !== "";
  } catch (err) {
    logger.warn(
      { event: "job_recent_seen_peek_failed", sourceUrl: normalizedUrl, err },
      "job_recent_seen_peek_failed",
    );
    return false;
  }
}

export async function shouldEnqueueJob(sourceUrl: string): Promise<boolean> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return true;
  const normalizedUrl = normalizeJobUrl(trimmed);

  try {
    const redis = getIoredis();
    const key = recentSeenKey(normalizedUrl);
    const setResult = await redis.set(key, "1", "EX", RECENT_SEEN_TTL_SEC, "NX");
    const firstClaim = setResult === "OK";
    /** `true` = URL was already in the recent window (skip enqueue to avoid duplicate parse work). */
    const seen = !firstClaim;
    /** `warn` so journalctl / default log sinks show enqueue-time dedup (revert to `info` if noisy). */
    logger.warn(
      { event: "dedupe_decision", normalizedUrl, seen },
      "dedupe_decision",
    );
    return firstClaim;
  } catch (err) {
    logger.warn(
      { event: "job_recent_seen_cache_error", sourceUrl: normalizedUrl, err },
      "job_recent_seen_cache_error",
    );
    return true;
  }
}
