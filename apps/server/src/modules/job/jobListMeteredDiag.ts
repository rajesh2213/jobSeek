import { performance } from "node:perf_hooks";
import { logger } from "../../utils/logger.js";
import type { JobDiscoveryFilters } from "./job.repository.js";

/** When `metered_list` (HTTP Server-Timing segment) exceeds this, emit `JOB_LIST_METERED_SLOW`. Off when unset/0. */
export function getJobListMeteredSlowThresholdMs(): number {
  const raw = process.env.JOB_LIST_METERED_SLOW_MS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Shallow, log-safe view of discovery filters (no location free-text tokens).
 */
export function summarizeJobDiscoveryFilters(filters: JobDiscoveryFilters | undefined): Record<string, unknown> {
  if (!filters) return {};
  return {
    category: filters.category ?? null,
    categoriesCount: filters.categories?.length ?? 0,
    role: filters.role ?? null,
    rolesCount: filters.roles?.length ?? 0,
    skillsCount: filters.skills?.length ?? 0,
    country: filters.country ?? null,
    countriesCount: filters.countries?.length ?? 0,
    hasLocationTokens: Boolean(filters.locationTokens?.length),
    hasLocation: Boolean(filters.location),
    postedWithin: filters.postedWithin ?? null,
    workType: filters.workType ?? null,
    workTypesCount: filters.workTypes?.length ?? 0,
    experienceLevel: filters.experienceLevel ?? null,
    minSalary: filters.minSalary ?? null,
    companyId: filters.companyId ? "[set]" : null,
    isRemote: filters.isRemote ?? null,
    includeProcessing: filters.includeProcessing ?? null,
  };
}

export function logJobListMeteredSlow(fields: Record<string, unknown>): void {
  logger.warn({ event: "JOB_LIST_METERED_SLOW", ...fields }, "job_list_metered_slow");
}

/**
 * Event-loop utilization since `eluStart` (Node `performance.eventLoopUtilization`).
 */
export function eventLoopUtilizationSince(eluStart: ReturnType<typeof performance.eventLoopUtilization>): {
  idleMs: number;
  activeMs: number;
  utilization: number;
} {
  const u = performance.eventLoopUtilization(eluStart);
  return {
    idleMs: Math.round(u.idle * 100) / 100,
    activeMs: Math.round(u.active * 100) / 100,
    utilization: Math.round(u.utilization * 10000) / 10000,
  };
}

export function createEventLoopUtilizationOrigin(): ReturnType<typeof performance.eventLoopUtilization> {
  return performance.eventLoopUtilization();
}
