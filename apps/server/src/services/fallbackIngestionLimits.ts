import { delay } from "../utils/common.js";
import { logger } from "../utils/logger.js";

let lastRemoteOkAt = 0;
let remoteOkBackoffMs = 0;

const MIN_GAP_REMOTEOK_MS = 2200;
const MIN_GAP_WELLFOUND_MS = 900;

let lastWellfoundFetchAt = 0;

/**
 * Global spacing + exponential backoff after 429/5xx on RemoteOK API.
 */
export async function throttleBeforeRemoteOkFetch(): Promise<void> {
  const gap = MIN_GAP_REMOTEOK_MS + remoteOkBackoffMs;
  const elapsed = Date.now() - lastRemoteOkAt;
  if (elapsed < gap) await delay(gap - elapsed);
}

export function markRemoteOkFetchStart(): void {
  lastRemoteOkAt = Date.now();
}

export function markRemoteOkSuccess(): void {
  remoteOkBackoffMs = Math.max(0, remoteOkBackoffMs - 1500);
}

export function markRemoteOkHttpError(status: number): void {
  if (status === 429 || status >= 500) {
    remoteOkBackoffMs = Math.min(90_000, Math.max(remoteOkBackoffMs, 2000) * 2);
    logger.warn(
      { event: "fallback_remoteok_backoff", status, backoff_ms: remoteOkBackoffMs },
      "fallback_remoteok_backoff",
    );
  }
}

export async function throttleBeforeWellfoundFetch(): Promise<void> {
  const elapsed = Date.now() - lastWellfoundFetchAt;
  if (elapsed < MIN_GAP_WELLFOUND_MS) await delay(MIN_GAP_WELLFOUND_MS - elapsed);
  lastWellfoundFetchAt = Date.now();
}
