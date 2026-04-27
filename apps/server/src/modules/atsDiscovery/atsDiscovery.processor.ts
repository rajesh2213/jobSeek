import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { logger } from "../../utils/logger.js";
import { getRedisConnection } from "../../queues/job.queue.js";
import {
  DISCOVER_ATS_ENDPOINTS_QUEUE_NAME,
  DISCOVER_FROM_JOBS_JOB,
  DISCOVER_FROM_SERP_JOB,
  type DiscoverFromJobsPayload,
  type DiscoverFromSerpPayload,
  getAtsDiscoveryQueue,
  closeAtsDiscoveryQueue,
  VALIDATE_ENDPOINT_JOB,
  type ValidateEndpointPayload,
} from "../../queues/atsDiscovery.queue.js";
import { assertWorkerProcessEnv } from "../../infrastructure/env/validateWorkerEnv.js";
import { registerWorkerShutdown } from "../../utils/workerShutdown.js";
import { ensureAtsEndpointTableReady } from "../atsEndpoint/atsEndpointReadiness.js";
import { createAtsEndpointService } from "../atsEndpoint/atsEndpoint.service.js";
import { createAtsCrawlerStandard } from "../ats/AtsCrawlerStandard.js";
import {
  asciiSafeLower,
  buildBaseUrl,
  parseAtsUrlToEndpoint,
} from "./atsUrlParser.js";
import { normalizeAtsUrl } from "../../utils/normalizeAtsUrl.js";
import type { AtsType } from "../ats/ats.interface.js";
import { CRAWLABLE_ATS_TYPES } from "../ats/ats.interface.js";
import type { NormalizedJob } from "../crawler/crawler.types.js";
import {
  recordDiscoveryPersistence,
  recordValidationPipeline,
} from "../../services/atsPipelineCounters.service.js";
import {
  assertRequiredSelect,
  logEfficiencyMetrics,
  logQueryMetrics,
} from "../../utils/queryMetrics.js";

const atsEndpointLifecycle = createAtsEndpointService(prisma);

const CRAWLABLE = new Set<string>(CRAWLABLE_ATS_TYPES);

const GENERIC_SLUGS = new Set(["jobs", "careers", "apply"]);

const DEFAULT_BATCH = 100;
const MIN_SERP_SCORE = 6;
const JOB_DISCOVERY_SCORE = 5;
const ACTIVATION_SCORE_THRESHOLD = 8;
const DEFAULT_VALIDATE_BATCH = 20;
const MIN_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
// REQUIRED_SELECT
const SERP_DISCOVERY_SELECT = {
  id: true,
  url: true,
  score: true,
  createdAt: true,
  atsType: true,
  slug: true,
} as const;

// REQUIRED_SELECT
const JOB_DISCOVERY_SELECT = {
  id: true,
  companyId: true,
  sourceUrl: true,
  applyUrl: true,
  lastSeenAt: true,
  lastProcessedAt: true,
} as const;

// REQUIRED_SELECT
const ATS_VALIDATE_SELECT = {
  id: true,
  type: true,
  slug: true,
  baseUrl: true,
  metadata: true,
  companyId: true,
  companyName: true,
  failureCount: true,
  lastFailureAt: true,
  score: true,
  lastCrawledAt: true,
} as const;

let lastSerpEstimatedKb = 0;
let lastJobsEstimatedKb = 0;
let lastSerpEfficiency = 1;
let lastJobsEfficiency = 1;

function adaptiveTake(base: number, lastEstimatedKb: number, lastEfficiency: number): number {
  let next = base;
  if (lastEstimatedKb > 500 || lastEfficiency < 0.1) next = Math.floor(base / 2);
  else if (lastEstimatedKb < 100) next = base + 20;
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, next));
}

export type AtsEndpointDiscoveryCandidate = {
  type: string;
  slug: string;
  baseUrl: string;
  crawlToken: string;
};

function isCrawlableAts(type: string): type is AtsType {
  return CRAWLABLE.has(type);
}

function isValidDiscoverySlug(slug: string | null | undefined, atsType: string | null | undefined): boolean {
  if (slug == null || atsType == null) return false;
  const s = slug.trim();
  if (s.length < 2) return false;
  if (GENERIC_SLUGS.has(s.toLowerCase())) return false;
  return true;
}

/**
 * Workday discovery: allow shallow board URLs and CXS job posting URLs (/job/loc/slug).
 * Deep non-/job/ paths still rejected — last path segment is not a reliable board site.
 */
function isStrictWorkdayDiscoveryUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".myworkdayjobs.com")) return true;

  const path = u.pathname || "/";
  const segs = path.split("/").filter(Boolean);
  const isCxsJobPosting = segs.length >= 3 && segs[0]!.toLowerCase() === "job";
  if (segs.length > 2 && !isCxsJobPosting) return false;

  const low = path.toLowerCase();
  if (low.includes("job-details")) return false;
  if (low.includes("posting")) return false;
  if (low.includes("req")) return false;
  if (!isCxsJobPosting && (low.includes("/job/") || low.endsWith("/job"))) return false;
  for (const s of segs) {
    if (s.toLowerCase() === "job" && !isCxsJobPosting) return false;
  }
  return true;
}

/** Cooldown after lastFailureAt before another validation attempt. */
function validationCooldownMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  if (failureCount === 1) return 5 * 60 * 1000;
  if (failureCount === 2) return 15 * 60 * 1000;
  if (failureCount === 3) return 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

async function markSerpRowDiscovered(serpResultId: string, url: string, extra: Record<string, unknown> = {}): Promise<void> {
  const now = new Date();
  await prisma.serpResult.update({
    where: { id: serpResultId },
    data: { discoveredAt: now },
  });
  logger.info(
    {
      event: "ats_endpoint_marked_discovered",
      serpResultId,
      url,
      ...extra,
    },
    "ats_endpoint_marked_discovered",
  );
}

function candidateFromParsed(parsed: NonNullable<ReturnType<typeof parseAtsUrlToEndpoint>>): AtsEndpointDiscoveryCandidate | null {
  if (!isCrawlableAts(parsed.type)) return null;
  if (!parsed.baseUrl?.trim()) return null;
  if (!isValidDiscoverySlug(parsed.slug, parsed.type)) return null;
  return {
    type: parsed.type,
    slug: parsed.slug,
    baseUrl: parsed.baseUrl.trim(),
    crawlToken: parsed.crawlToken,
  };
}

/**
 * Prefer full URL parse (correct Workday slug/token); fall back to SerpResult fields for simple boards.
 */
function candidateFromSerpRow(row: {
  url: string;
  atsType: string | null;
  slug: string | null;
}): AtsEndpointDiscoveryCandidate | null {
  const normalizedUrl = normalizeAtsUrl(row.url) || row.url;
  const parsed = parseAtsUrlToEndpoint(normalizedUrl);
  if (parsed) {
    return candidateFromParsed(parsed);
  }

  if (row.atsType == null || row.slug == null) return null;
  if (!isCrawlableAts(row.atsType)) return null;
  if (row.atsType === "workday") return null;

  const slug = asciiSafeLower(row.slug);
  if (!isValidDiscoverySlug(slug, row.atsType)) return null;

  const baseUrl = buildBaseUrl(row.atsType, slug);
  if (!baseUrl) return null;

  return {
    type: row.atsType,
    slug,
    baseUrl,
    crawlToken: slug,
  };
}

async function persistEndpointCandidate(
  candidate: AtsEndpointDiscoveryCandidate,
  ctx: {
    source: "serp" | "job";
    discoveryScore: number;
    url: string;
    jobId?: string;
    companyId?: string | null;
  },
): Promise<void> {
  const meta: Prisma.InputJsonValue = { crawlToken: candidate.crawlToken };
  const now = new Date();
  const incomingScore = ctx.discoveryScore;

  const existing = await prisma.atsEndpoint.findUnique({
    where: { type_slug: { type: candidate.type, slug: candidate.slug } },
  });

  if (existing) {
    await prisma.atsEndpoint.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        ...(incomingScore > existing.score ? { score: incomingScore } : {}),
      },
    });
    recordDiscoveryPersistence(ctx.source, "skipped_duplicate");
    logger.info(
      {
        event: "ats_endpoint_discovery_attempt",
        source: ctx.source,
        atsType: candidate.type,
        slug: candidate.slug,
        accepted: false,
        reason: "duplicate_endpoint",
      },
      "ats_endpoint_discovery_attempt",
    );
    logger.info(
      {
        event: "ats_endpoint_duplicate_skipped",
        type: candidate.type,
        slug: candidate.slug,
        url: ctx.url,
        score: incomingScore,
        jobId: ctx.jobId,
      },
      "ats_endpoint_duplicate_skipped",
    );
    return;
  }

  const isActive = incomingScore >= ACTIVATION_SCORE_THRESHOLD;

  if (ctx.companyId) {
    const n = await prisma.atsEndpoint.count({ where: { companyId: ctx.companyId } });
    if (n >= 3) {
      recordDiscoveryPersistence(ctx.source, "skipped_company_limit");
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: ctx.source,
          atsType: candidate.type,
          slug: candidate.slug,
          accepted: false,
          reason: "company_limit",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        {
          event: "ats_endpoint_skipped_company_limit",
          companyId: ctx.companyId,
          type: candidate.type,
          slug: candidate.slug,
          url: ctx.url,
          jobId: ctx.jobId,
        },
        "ats_endpoint_skipped_company_limit",
      );
      return;
    }
  }

  try {
    await prisma.atsEndpoint.create({
      data: {
        type: candidate.type,
        slug: candidate.slug,
        baseUrl: candidate.baseUrl,
        isActive,
        failureCount: 0,
        successCount: 0,
        metadata: meta,
        lastSeenAt: now,
        source: ctx.source,
        score: incomingScore,
        ...(ctx.companyId ? { companyId: ctx.companyId } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.atsEndpoint.findUnique({
        where: { type_slug: { type: candidate.type, slug: candidate.slug } },
      });
      if (row) {
        await prisma.atsEndpoint.update({
          where: { id: row.id },
          data: {
            lastSeenAt: now,
            ...(incomingScore > row.score ? { score: incomingScore } : {}),
          },
        });
      }
      recordDiscoveryPersistence(ctx.source, "skipped_race_duplicate");
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: ctx.source,
          atsType: candidate.type,
          slug: candidate.slug,
          accepted: false,
          reason: "p2002_race",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        {
          event: "ats_endpoint_duplicate_skipped",
          type: candidate.type,
          slug: candidate.slug,
          url: ctx.url,
          score: incomingScore,
          jobId: ctx.jobId,
          reason: "p2002_race",
        },
        "ats_endpoint_duplicate_skipped",
      );
      return;
    }
    throw err;
  }

  recordDiscoveryPersistence(ctx.source, "created");
  logger.info(
    {
      event: "ats_endpoint_discovery_attempt",
      source: ctx.source,
      atsType: candidate.type,
      slug: candidate.slug,
      accepted: true,
    },
    "ats_endpoint_discovery_attempt",
  );

  if (ctx.source === "serp") {
    logger.info(
      {
        event: "ats_endpoint_discovered_from_serp",
        type: candidate.type,
        slug: candidate.slug,
        score: incomingScore,
        url: ctx.url,
      },
      "ats_endpoint_discovered_from_serp",
    );
  } else {
    logger.info(
      {
        event: "ats_endpoint_discovered_from_job",
        type: candidate.type,
        slug: candidate.slug,
        score: incomingScore,
        url: ctx.url,
        jobId: ctx.jobId,
      },
      "ats_endpoint_discovered_from_job",
    );
  }

  if (isActive) {
    logger.info(
      {
        event: "ats_endpoint_activated",
        type: candidate.type,
        slug: candidate.slug,
        url: ctx.url,
        reason: "discovery_score_threshold",
        score: incomingScore,
      },
      "ats_endpoint_activated",
    );
  }
}

async function discoverFromSerp(batchSize: number): Promise<void> {
  if (lastSerpEfficiency < 0.05) {
    logger.warn(
      { event: "ats_discovery_serp_skipped_low_efficiency_backpressure", lastSerpEfficiency },
      "ats_discovery_serp_skipped_low_efficiency_backpressure",
    );
    lastSerpEfficiency = 1;
    return;
  }
  const take = adaptiveTake(Math.min(100, Math.max(25, batchSize)), lastSerpEstimatedKb, lastSerpEfficiency);
  assertRequiredSelect("SerpResult", "atsDiscovery.discoverFromSerp.findMany", SERP_DISCOVERY_SELECT);

  const rows = await prisma.serpResult.findMany({
    where: {
      discoveredAt: null,
      atsType: { not: null },
      slug: { not: null },
      score: { gte: MIN_SERP_SCORE },
    },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take,
    select: SERP_DISCOVERY_SELECT,
  });
  const queryMetrics = logQueryMetrics("atsDiscovery.discoverFromSerp.findMany", rows, 350);
  lastSerpEstimatedKb = queryMetrics.estimatedKB;

  const roiFirst = ["greenhouse", "lever"];
  rows.sort((a, b) => {
    const ar = a.atsType && roiFirst.includes(a.atsType) ? 1 : 0;
    const br = b.atsType && roiFirst.includes(b.atsType) ? 1 : 0;
    if (br !== ar) return br - ar;
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    return 0;
  });

  let updatedRows = 0;
  let skippedRows = 0;
  for (const row of rows) {
    const markDone = async (extra?: Record<string, unknown>) => {
      await markSerpRowDiscovered(row.id, row.url, extra ?? {});
    };

    if (!row.atsType || !row.slug) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "serp",
          atsType: row.atsType,
          slug: row.slug,
          accepted: false,
          reason: "missing_ats_or_slug",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        { event: "ats_endpoint_invalid_skipped", reason: "missing_ats_or_slug", url: row.url },
        "ats_endpoint_invalid_skipped",
      );
      await markDone({ reason: "missing_ats_or_slug" });
      skippedRows += 1;
      continue;
    }

    if (!isStrictWorkdayDiscoveryUrl(row.url)) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "serp",
          atsType: row.atsType,
          slug: row.slug,
          accepted: false,
          reason: "workday_url_rejected",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        { event: "ats_endpoint_invalid_skipped", reason: "workday_url_rejected", url: row.url },
        "ats_endpoint_invalid_skipped",
      );
      await markDone({ reason: "workday_url_rejected" });
      skippedRows += 1;
      continue;
    }

    const candidate = candidateFromSerpRow(row);
    if (!candidate) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "serp",
          atsType: row.atsType,
          slug: row.slug,
          accepted: false,
          reason: "unresolved_candidate",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        {
          event: "ats_endpoint_invalid_skipped",
          reason: "unresolved_candidate",
          url: row.url,
          atsType: row.atsType,
          slug: row.slug,
        },
        "ats_endpoint_invalid_skipped",
      );
      await markDone({ reason: "unresolved_candidate" });
      skippedRows += 1;
      continue;
    }

    if (!isValidDiscoverySlug(candidate.slug, candidate.type)) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "serp",
          atsType: candidate.type,
          slug: candidate.slug,
          accepted: false,
          reason: "slug_guard",
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        {
          event: "ats_endpoint_invalid_skipped",
          reason: "slug_guard",
          type: candidate.type,
          slug: candidate.slug,
          url: row.url,
        },
        "ats_endpoint_invalid_skipped",
      );
      await markDone({ reason: "slug_guard" });
      skippedRows += 1;
      continue;
    }

    try {
      await persistEndpointCandidate(candidate, {
        source: "serp",
        discoveryScore: row.score ?? 0,
        url: row.url,
      });
      await markDone({ reason: "processed" });
      updatedRows += 1;
    } catch (err) {
      logger.error(
        { event: "ats_discovery_serp_row_failed", serpResultId: row.id, url: row.url, err },
        "ats_discovery_serp_row_failed",
      );
      skippedRows += 1;
    }
  }
  lastSerpEfficiency = logEfficiencyMetrics({
    name: "atsDiscovery.discoverFromSerp",
    readRows: rows.length,
    updatedRows,
    skippedRows,
  });
}

async function discoverFromJobs(batchSize: number): Promise<void> {
  if (lastJobsEfficiency < 0.05) {
    logger.warn(
      { event: "ats_discovery_jobs_skipped_low_efficiency_backpressure", lastJobsEfficiency },
      "ats_discovery_jobs_skipped_low_efficiency_backpressure",
    );
    lastJobsEfficiency = 1;
    return;
  }
  const take = adaptiveTake(Math.min(100, Math.max(25, batchSize)), lastJobsEstimatedKb, lastJobsEfficiency);
  const now = new Date();
  const nowMs = now.getTime();
  const lookbackDays = Math.max(1, Number(process.env.PROCESSING_LOOKBACK_DAYS ?? "7") || 7);
  const lookbackSince = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000);
  const jobIdRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Job"
    WHERE (
      "lastProcessedAt" IS NULL
      OR "lastSeenAt" > "lastProcessedAt"
    )
      AND "lastSeenAt" >= ${lookbackSince}
    ORDER BY COALESCE("lastProcessedAt", TO_TIMESTAMP(0)) ASC, "lastSeenAt" DESC
    LIMIT ${take}
  `;
  const jobIds = jobIdRows.map((row) => row.id);
  if (jobIds.length === 0) return;

  assertRequiredSelect("Job", "atsDiscovery.discoverFromJobs.findMany", JOB_DISCOVERY_SELECT);
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: JOB_DISCOVERY_SELECT,
  });
  const jobOrder = new Map(jobIds.map((id, idx) => [id, idx]));
  jobs.sort((a, b) => (jobOrder.get(a.id) ?? 0) - (jobOrder.get(b.id) ?? 0));
  const queryMetrics = logQueryMetrics("atsDiscovery.discoverFromJobs.findMany", jobs, 600);
  lastJobsEstimatedKb = queryMetrics.estimatedKB;

  const processedJobIds: string[] = [];
  let updatedRows = 0;
  let skippedRows = 0;
  for (const job of jobs) {
    processedJobIds.push(job.id);
    const urls = [job.sourceUrl, job.applyUrl].filter((u): u is string => typeof u === "string" && u.trim().length > 0);

    let candidate: AtsEndpointDiscoveryCandidate | null = null;
    let usedUrl = "";

    for (const raw of urls) {
      const normalized = normalizeAtsUrl(raw) || raw;
      const parsed = parseAtsUrlToEndpoint(normalized);
      if (parsed) {
        const c = candidateFromParsed(parsed);
        if (c) {
          candidate = c;
          usedUrl = raw;
          break;
        }
      }
    }

    if (!candidate || !usedUrl) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "job",
          atsType: null,
          slug: null,
          accepted: false,
          reason: "job_url_not_ats_board",
          jobId: job.id,
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        { event: "ats_endpoint_invalid_skipped", reason: "job_url_not_ats_board", jobId: job.id },
        "ats_endpoint_invalid_skipped",
      );
      skippedRows += 1;
      continue;
    }

    if (!isStrictWorkdayDiscoveryUrl(usedUrl)) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "job",
          atsType: candidate.type,
          slug: candidate.slug,
          accepted: false,
          reason: "workday_url_rejected",
          jobId: job.id,
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        { event: "ats_endpoint_invalid_skipped", reason: "workday_url_rejected", jobId: job.id, url: usedUrl },
        "ats_endpoint_invalid_skipped",
      );
      skippedRows += 1;
      continue;
    }

    if (!isValidDiscoverySlug(candidate.slug, candidate.type)) {
      logger.info(
        {
          event: "ats_endpoint_discovery_attempt",
          source: "job",
          atsType: candidate.type,
          slug: candidate.slug,
          accepted: false,
          reason: "slug_guard",
          jobId: job.id,
        },
        "ats_endpoint_discovery_attempt",
      );
      logger.info(
        {
          event: "ats_endpoint_invalid_skipped",
          reason: "slug_guard",
          type: candidate.type,
          slug: candidate.slug,
          jobId: job.id,
          url: usedUrl,
        },
        "ats_endpoint_invalid_skipped",
      );
      skippedRows += 1;
      continue;
    }

    try {
      await persistEndpointCandidate(candidate, {
        source: "job",
        discoveryScore: JOB_DISCOVERY_SCORE,
        url: usedUrl,
        jobId: job.id,
        companyId: job.companyId,
      });
      updatedRows += 1;
    } catch (err) {
      logger.error({ event: "ats_discovery_job_row_failed", jobId: job.id, url: usedUrl, err }, "ats_discovery_job_row_failed");
      skippedRows += 1;
    }
  }

  if (processedJobIds.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: processedJobIds } },
      data: { lastProcessedAt: now },
    });
  }
  lastJobsEfficiency = logEfficiencyMetrics({
    name: "atsDiscovery.discoverFromJobs",
    readRows: jobs.length,
    updatedRows,
    skippedRows,
  });
}

async function validateEndpointsBatch(batchSize: number, priorityBand: "high" | "low" = "high"): Promise<void> {
  const take = Math.min(100, Math.max(1, batchSize));
  assertRequiredSelect("AtsEndpoint", `atsDiscovery.validate.findMany.${priorityBand}`, ATS_VALIDATE_SELECT);
  const pool = await prisma.atsEndpoint.findMany({
    where: {
      isActive: false,
      ...(priorityBand === "high" ? { score: { gte: 40 } } : { score: { lt: 40 } }),
    },
    orderBy: [{ score: "desc" }, { failureCount: "asc" }, { lastSeenAt: "desc" }],
    take: Math.min(100, take * 5),
    select: ATS_VALIDATE_SELECT,
  });
  logQueryMetrics(`atsDiscovery.validate.findMany.${priorityBand}`, pool, 450);

  const nowMs = Date.now();
  const eligible = pool.filter((ep) => {
    if (ep.lastFailureAt == null) return true;
    return ep.lastFailureAt.getTime() <= nowMs - validationCooldownMs(ep.failureCount);
  });

  const endpoints = eligible.slice(0, take);
  let updatedRows = 0;
  let skippedRows = 0;

  for (const ep of endpoints) {
    const atsType = ep.type as AtsType;
    logger.info(
      {
        event: "ats_endpoint_validation_attempted",
        endpointId: ep.id,
        type: ep.type,
        slug: ep.slug,
        failureCount: ep.failureCount,
      },
      "ats_endpoint_validation_attempted",
    );

    const endpointForAdapter = {
      id: ep.id,
      type: atsType,
      slug: ep.slug,
      baseUrl: ep.baseUrl,
      metadata: ep.metadata,
      companyId: ep.companyId,
      companyName: ep.companyName?.trim() || `${ep.type}:${ep.slug.slice(0, 48)}`,
    };

    let jobs: NormalizedJob[] = [];
    try {
      const standard = createAtsCrawlerStandard(atsType);
      jobs = await standard.fetchJobs(endpointForAdapter);
    } catch (err) {
      logger.info(
        {
          event: "ats_endpoint_validation_failed",
          endpointId: ep.id,
          type: ep.type,
          slug: ep.slug,
          baseUrl: ep.baseUrl,
          reason: "crawler_error",
          err,
        },
        "ats_endpoint_validation_failed",
      );
      await atsEndpointLifecycle.markFailure(ep.id);
      recordValidationPipeline(0);
      logger.info(
        {
          event: "ats_endpoint_validation_summary",
          endpointId: ep.id,
          atsType: ep.type,
          jobsFetched: 0,
          success: false,
        },
        "ats_endpoint_validation_summary",
      );
      skippedRows += 1;
      continue;
    }

    const now = new Date();
    if (jobs.length >= 1) {
      await prisma.atsEndpoint.update({
        where: { id: ep.id },
        data: {
          isActive: true,
          failureCount: 0,
          successCount: { increment: 1 },
          lastCheckedAt: now,
          lastSuccessAt: now,
          lastCrawledAt: now,
        },
      });
      logger.info(
        {
          event: "ats_endpoint_validation_passed",
          endpointId: ep.id,
          type: ep.type,
          slug: ep.slug,
          baseUrl: ep.baseUrl,
          jobCount: jobs.length,
        },
        "ats_endpoint_validation_passed",
      );
      updatedRows += 1;
      logger.info(
        {
          event: "ats_endpoint_activated",
          endpointId: ep.id,
          type: ep.type,
          slug: ep.slug,
          reason: "validation",
        },
        "ats_endpoint_activated",
      );
    } else {
      logger.info(
        {
          event: "ats_endpoint_validation_failed",
          endpointId: ep.id,
          type: ep.type,
          slug: ep.slug,
          baseUrl: ep.baseUrl,
          reason: "zero_jobs",
        },
        "ats_endpoint_validation_failed",
      );
      await atsEndpointLifecycle.markFailure(ep.id);
      skippedRows += 1;
    }

    recordValidationPipeline(jobs.length);
    logger.info(
      {
        event: "ats_endpoint_validation_summary",
        endpointId: ep.id,
        atsType: ep.type,
        jobsFetched: jobs.length,
        success: jobs.length >= 1,
      },
      "ats_endpoint_validation_summary",
    );
  }
  logEfficiencyMetrics({
    name: `atsDiscovery.validate.${priorityBand}`,
    readRows: endpoints.length,
    updatedRows,
    skippedRows,
  });
}

function isSerpPayload(data: unknown): data is DiscoverFromSerpPayload {
  if (data === undefined || data === null) return true;
  if (typeof data !== "object" || data === null) return false;
  const o = data as Record<string, unknown>;
  if (o.batchSize !== undefined && (typeof o.batchSize !== "number" || !Number.isFinite(o.batchSize))) return false;
  return true;
}

function isJobsPayload(data: unknown): data is DiscoverFromJobsPayload {
  if (data === undefined || data === null) return true;
  if (typeof data !== "object" || data === null) return false;
  const o = data as Record<string, unknown>;
  if (o.batchSize !== undefined && (typeof o.batchSize !== "number" || !Number.isFinite(o.batchSize))) return false;
  return true;
}

function isValidatePayload(data: unknown): data is ValidateEndpointPayload {
  if (data === undefined || data === null) return true;
  if (typeof data !== "object" || data === null) return false;
  const o = data as Record<string, unknown>;
  if (o.batchSize !== undefined && (typeof o.batchSize !== "number" || !Number.isFinite(o.batchSize))) return false;
  if (o.priorityBand !== undefined && o.priorityBand !== "high" && o.priorityBand !== "low") return false;
  return true;
}

async function start(): Promise<void> {
  loadRootEnv();
  assertWorkerProcessEnv();
  getAtsDiscoveryQueue();

  const tableOk = await ensureAtsEndpointTableReady(prisma, "ats_discovery_worker_boot");
  if (!tableOk) {
    logger.error(
      { event: "ats_discovery_worker_disabled", reason: "ats_endpoint_table_missing" },
      "AtsEndpoint table missing — discovery worker idle",
    );
  }

  const worker = new Worker(
    DISCOVER_ATS_ENDPOINTS_QUEUE_NAME,
    async (job) => {
      if (!tableOk) {
        const ok = await ensureAtsEndpointTableReady(prisma, "ats_discovery_job");
        if (!ok) {
          logger.warn({ event: "ats_discovery_job_skipped", reason: "table_missing" }, "ats_discovery_job_skipped");
          return;
        }
      }

      if (job.name === DISCOVER_FROM_SERP_JOB) {
        if (!isSerpPayload(job.data)) throw new Error("Invalid discover_from_serp payload");
        const batchSize = typeof job.data?.batchSize === "number" ? job.data.batchSize : DEFAULT_BATCH;
        await discoverFromSerp(batchSize);
        return;
      }

      if (job.name === DISCOVER_FROM_JOBS_JOB) {
        if (!isJobsPayload(job.data)) throw new Error("Invalid discover_from_jobs payload");
        const batchSize = typeof job.data?.batchSize === "number" ? job.data.batchSize : DEFAULT_BATCH;
        await discoverFromJobs(batchSize);
        return;
      }

      if (job.name === VALIDATE_ENDPOINT_JOB) {
        if (!isValidatePayload(job.data)) throw new Error("Invalid validate_endpoint payload");
        const batchSize = typeof job.data?.batchSize === "number" ? job.data.batchSize : DEFAULT_VALIDATE_BATCH;
        const priorityBand = job.data?.priorityBand === "low" ? "low" : "high";
        await validateEndpointsBatch(batchSize, priorityBand);
        return;
      }

      throw new Error(`Unknown ATS discovery job name: ${job.name}`);
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ event: "ats_discovery_worker_job_failed", jobId: job?.id, err }, "ats_discovery_worker_job_failed");
  });

  logger.info({ event: "ats_discovery_worker_started" }, "ats_discovery_worker_started");

  registerWorkerShutdown({
    worker,
    closeQueues: [closeAtsDiscoveryQueue],
    prismaDisconnect: () => prisma.$disconnect(),
  });
}

void start().catch((err) => {
  logger.error({ event: "ats_discovery_worker_boot_failed", err }, "ats_discovery_worker_boot_failed");
  process.exitCode = 1;
});
