/**
 * Scheduler + scoring guarantees for activated OpenClaw discovery boards.
 * Inactive inventory rows are unchanged; only active `source=openclaw` endpoints
 * get a score floor so they compete in the hot tier and are reserved in the scheduler.
 */

export const OPENCLAW_SOURCE = "openclaw";

const DEFAULT_ACTIVE_MIN_SCORE = 70;
/** 4h — avoids hot-tier over-crawl on large Workday boards while staying fresher than warm default. */
const DEFAULT_ACTIVE_CRAWL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export function openClawActiveMinScore(): number {
  const raw = Number(process.env.OPENCLAW_ACTIVE_MIN_SCORE ?? String(DEFAULT_ACTIVE_MIN_SCORE));
  if (!Number.isFinite(raw)) return DEFAULT_ACTIVE_MIN_SCORE;
  return Math.max(40, Math.min(100, Math.floor(raw)));
}

/** Min ms between scheduled recrawls for active OpenClaw boards (independent of dynamic score tier). */
export function openClawActiveCrawlCooldownMs(): number {
  const raw = Number(
    process.env.OPENCLAW_ACTIVE_CRAWL_COOLDOWN_MS ?? String(DEFAULT_ACTIVE_CRAWL_COOLDOWN_MS),
  );
  if (!Number.isFinite(raw)) return DEFAULT_ACTIVE_CRAWL_COOLDOWN_MS;
  return Math.max(30 * 60_000, Math.min(24 * 60 * 60_000, Math.floor(raw)));
}

export function isOpenClawPastActiveCrawlCooldown(
  lastCrawledAt: Date | null,
  nowMs = Date.now(),
): boolean {
  if (lastCrawledAt == null) return true;
  return lastCrawledAt.getTime() < nowMs - openClawActiveCrawlCooldownMs();
}

export function isOpenClawActiveEndpoint(source: string | null | undefined, isActive: boolean): boolean {
  return isActive && source === OPENCLAW_SOURCE;
}

/** Apply production floor after dynamic recompute (or before persist). */
export function applyOpenClawActiveScoreFloor(
  score: number,
  source: string | null | undefined,
  isActive: boolean,
): number {
  if (!isOpenClawActiveEndpoint(source, isActive)) return score;
  return Math.max(score, openClawActiveMinScore());
}

/** Extra sort weight so openclaw boards rank above enrichment when scores tie. */
export const OPENCLAW_SCHEDULER_PRIORITY_BOOST = 500;

export function openClawSchedulerPriorityBoost(
  source: string | null | undefined,
  isActive: boolean,
): number {
  return isOpenClawActiveEndpoint(source, isActive) ? OPENCLAW_SCHEDULER_PRIORITY_BOOST : 0;
}
