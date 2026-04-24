import { getIoredis } from "../queues/job.queue.js";
import { logger } from "../utils/logger.js";
import { normalizeJobUrl } from "../utils/normalizeJobUrl.js";

const DEFAULT_RECENT_SEEN_TTL_SEC = 6 * 60 * 60;
const RECENT_SEEN_TTL_SEC = Math.max(
  60,
  Number(process.env.PROCESS_JOB_RECENT_SEEN_TTL_SEC ?? "21600") || DEFAULT_RECENT_SEEN_TTL_SEC,
);

function recentSeenKey(sourceUrl: string): string {
  return `job:seen:${sourceUrl}`;
}

export async function shouldEnqueueJob(sourceUrl: string): Promise<boolean> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return true;
  const normalizedUrl = normalizeJobUrl(trimmed);

  try {
    const redis = getIoredis();
    const key = recentSeenKey(normalizedUrl);
    const setResult = await redis.set(key, "1", "EX", RECENT_SEEN_TTL_SEC, "NX");
    return setResult === "OK";
  } catch (err) {
    logger.warn(
      { event: "job_recent_seen_cache_error", sourceUrl: normalizedUrl, err },
      "job_recent_seen_cache_error",
    );
    return true;
  }
}
