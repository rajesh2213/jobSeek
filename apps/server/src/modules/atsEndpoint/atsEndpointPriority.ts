import type { AtsEndpoint } from "@prisma/client";
import { openClawSchedulerPriorityBoost } from "./openClawActiveScore.js";

export type EndpointPriorityFields = Pick<
  AtsEndpoint,
  "score" | "successCount" | "lastCrawledAt"
> & {
  source?: string | null;
  isActive?: boolean;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;

/**
 * Staleness boost for adaptive scheduling (never crawled / older crawls rank higher).
 */
export function freshnessBoost(lastCrawledAt: Date | null): number {
  if (lastCrawledAt == null) return 10;
  const ageMs = Date.now() - lastCrawledAt.getTime();
  if (ageMs > SIX_HOURS_MS) return 8;
  if (ageMs > ONE_HOUR_MS) return 5;
  return 0;
}

/**
 * Higher = should be crawled sooner (Phase 5 scheduling signal).
 */
export function getEndpointPriority(endpoint: EndpointPriorityFields): number {
  return (
    endpoint.score * 2 +
    endpoint.successCount +
    freshnessBoost(endpoint.lastCrawledAt) +
    openClawSchedulerPriorityBoost(endpoint.source, endpoint.isActive ?? true)
  );
}
