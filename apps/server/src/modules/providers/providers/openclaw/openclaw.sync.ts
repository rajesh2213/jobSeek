import { createHash } from "node:crypto";
import type { Company, PrismaClient } from "@prisma/client";
import type { JobService } from "../../../job/job.service.js";
import type { CompanyService } from "../../../company/company.service.js";
import { DiscoveryService } from "../../../discovery/discovery.service.js";
import { loadOpenClawEnv, type OpenClawEnvConfig } from "./openclaw.env.js";
import { OpenClawClient } from "./openclaw.client.js";
import {
  extractJobsArray,
  extractCompanyHints,
  tryMapOpenClawJobToNormalized,
} from "./openclaw.mapper.js";
import { extractCompanyDomain } from "../../../../utils/jobFingerprint.js";
import { getIoredis } from "../../../../queues/job.queue.js";
import type { Redis } from "ioredis";
import { logger } from "../../../../utils/logger.js";
import { setOpenClawHealth } from "./openclaw.state.js";
import { enrichDedupInput } from "../../../../utils/jobTaxonomyEnricher.js";
import { fingerprintFromNormalized } from "../../../../services/jobDedup.service.js";
import { normalizeJobUrl } from "../../../../utils/normalizeJobUrl.js";
import type { JobRepository } from "../../../job/job.repository.js";
import { CRAWLABLE_ATS_TYPES, type AtsType } from "../../../ats/ats.interface.js";
import { normalizeDomain } from "../../../../utils/common.js";
import { incrOpenClawMetric, recordOpenClawShadowParseEval } from "./openclaw.analytics.js";
import {
  createEmptyOpenClawShadowSummary,
  evaluateOpenClawShadowParseEligibility,
  mergeOpenClawShadowEvalIntoSummary,
  sourceUrlHost,
} from "./openclaw.parseShadow.js";
import { peekRecentSeenBlocksEnqueue } from "../../../../services/recentJobSeen.service.js";
import { computeCompanyQualityFlags } from "../../../../services/qualityFlags.service.js";

const PAGING_KEY = "openclaw:paging:next_page";

function tryRedis(): Redis | null {
  try {
    return getIoredis();
  } catch {
    return null;
  }
}

function isCrawlableAts(value: string | null | undefined): value is AtsType {
  if (!value?.trim()) return false;
  return (CRAWLABLE_ATS_TYPES as readonly string[]).includes(value.trim());
}

async function readNextPage(redis: Redis | null): Promise<number> {
  if (!redis) return 1;
  try {
    const raw = await redis.get(PAGING_KEY);
    const n = Number(raw ?? "1");
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  } catch {
    return 1;
  }
}

async function writeNextPage(redis: Redis | null, page: number, hasNext: boolean): Promise<void> {
  if (!redis) return;
  try {
    const next = hasNext ? page + 1 : 1;
    await redis.set(PAGING_KEY, String(next), "PX", 7 * 24 * 60 * 60 * 1000);
  } catch {
    /* ignore */
  }
}

/**
 * OpenClaw company hints are enrichment-only: fill gaps, never replace trusted ATS/domain data.
 * If either `atsType` or `atsBoardToken` is already set (from JobLoom enrichment/crawl), skip both
 * ATS hint fields so we never "patch" or contradict primary detection.
 * Exported for unit tests.
 */
export function computeOpenClawCompanyHintPatch(
  row: Pick<Company, "domain" | "careersUrl" | "atsType" | "atsBoardToken">,
  hints: ReturnType<typeof extractCompanyHints>,
): Partial<Pick<Company, "domain" | "careersUrl" | "atsType" | "atsBoardToken">> | null {
  const data: Partial<Pick<Company, "domain" | "careersUrl" | "atsType" | "atsBoardToken">> = {};

  if (hints.domain && !row.domain) {
    const d = normalizeDomain(hints.domain);
    if (d) data.domain = d;
  }
  if (hints.careersUrl?.trim() && !row.careersUrl) {
    data.careersUrl = hints.careersUrl.trim();
  }

  const hasTrustedAts = Boolean(row.atsType?.trim() || row.atsBoardToken?.trim());
  if (!hasTrustedAts) {
    if (hints.atsType?.trim() && !row.atsType && isCrawlableAts(hints.atsType)) {
      data.atsType = hints.atsType.trim();
    }
    if (hints.atsBoardToken?.trim() && !row.atsBoardToken) {
      data.atsBoardToken = hints.atsBoardToken.trim();
    }
  }

  if (Object.keys(data).length === 0) return null;
  return data;
}

async function mergeOpenClawHints(
  prisma: PrismaClient,
  companyId: string,
  hints: ReturnType<typeof extractCompanyHints>,
): Promise<boolean> {
  const row = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, domain: true, careersUrl: true, atsType: true, atsBoardToken: true },
  });
  if (!row) return false;
  const data = computeOpenClawCompanyHintPatch(row, hints);
  if (!data) return false;
  const nextDomain = data.domain !== undefined ? data.domain : row.domain;
  const nextAtsType = data.atsType !== undefined ? data.atsType : row.atsType;
  const nextAtsBoardToken =
    data.atsBoardToken !== undefined ? data.atsBoardToken : row.atsBoardToken;
  const flags = computeCompanyQualityFlags({
    name: row.name,
    domain: nextDomain ?? null,
    atsType: nextAtsType ?? null,
    atsBoardToken: nextAtsBoardToken ?? null,
  });
  await prisma.company.update({
    where: { id: companyId },
    data: {
      ...data,
      isPlaceholderCompany: flags.isPlaceholderCompany,
      isCompanyVerified: flags.isCompanyVerified,
      requiresCompanyRepair: flags.requiresCompanyRepair,
    },
  });
  return true;
}

async function simulateDedupOutcome(
  repo: JobRepository,
  row: Parameters<JobService["ingestDeduplicated"]>[0],
): Promise<"idempotent" | "would_ingest"> {
  const input = enrichDedupInput({ ...row, sourceUrl: normalizeJobUrl(row.sourceUrl) });
  const existingByUrl = await repo.findBySourceUrl(input.sourceUrl);
  if (existingByUrl) return "idempotent";
  void fingerprintFromNormalized(input);
  return "would_ingest";
}

/**
 * Stable synthetic company id for zero-write dry-run — never matches a Postgres `Company.id`.
 * Exported for unit tests.
 */
export function openclawDryRunSyntheticCompanyId(
  hints: ReturnType<typeof extractCompanyHints>,
): string {
  const name = hints.companyName?.trim() ?? "";
  const dom = hints.domain?.trim() ?? "";
  const digest = createHash("sha256")
    .update(`openclaw:dry-run\n${name}\n${dom}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `dry-run:${digest}`;
}

/**
 * Company fields for mapper + dedup simulation without touching `Company` rows or discovery.
 * Prefer payload `domain` / `careersUrl` hints for `companyDomain` so fingerprints stay realistic.
 */
export function buildOpenClawDryRunCompanyObservation(
  hints: ReturnType<typeof extractCompanyHints>,
): { companyId: string; displayName: string; companyDomain: string } {
  const companyId = openclawDryRunSyntheticCompanyId(hints);
  const displayName = hints.companyName?.trim() || "Unknown Company";
  const companyDomain =
    normalizeDomain(hints.domain ?? "") ||
    extractCompanyDomain(hints.careersUrl, companyId);
  return { companyId, displayName, companyDomain };
}

async function resolveCompanyIdForOpenClaw(
  cfg: OpenClawEnvConfig,
  companyService: CompanyService,
  discoveryService: DiscoveryService,
  hints: ReturnType<typeof extractCompanyHints>,
  redis: Redis | null,
): Promise<string> {
  const name = hints.companyName?.trim() || "Unknown Company";
  const existing = await companyService.findByName(name);
  if (existing) return existing.id;

  if (cfg.discoveryEnabled) {
    const outcome = await discoveryService.processCompanyCandidate({
      source: "openclaw",
      name,
      domain: hints.domain ?? undefined,
    });
    if (outcome === "added") await incrOpenClawMetric(redis, "companies_discovered", 1);
    const created = await companyService.findByName(name);
    if (created) return created.id;
  }

  const { companyId } = await companyService.ensureCompanyFromJob({ companyName: name });
  return companyId;
}

export interface OpenClawSyncContext {
  prisma: PrismaClient;
  jobService: JobService;
  companyService: CompanyService;
  jobRepository: JobRepository;
}

export async function runOpenClawSync(ctx: OpenClawSyncContext): Promise<{
  ok: boolean;
  jobsProcessed: number;
  dryRun: boolean;
  stopReason?: string;
}> {
  const cfg = loadOpenClawEnv();
  const redis = tryRedis();
  const client = new OpenClawClient(cfg, () => redis);

  if (!cfg.enabled) {
    setOpenClawHealth("disabled", "OPENCLAW_ENABLED=false", null);
    logger.info(
      { event: "sync_skipped", provider: "openclaw", reason: "disabled_env" },
      "openclaw_sync_skipped",
    );
    return { ok: true, jobsProcessed: 0, dryRun: cfg.dryRun, stopReason: "disabled" };
  }

  if (!cfg.syncEnabled) {
    setOpenClawHealth("disabled", "OPENCLAW_SYNC_ENABLED=false", null);
    logger.info(
      { event: "sync_skipped", provider: "openclaw", reason: "sync_off" },
      "openclaw_sync_skipped",
    );
    return { ok: true, jobsProcessed: 0, dryRun: cfg.dryRun, stopReason: "sync_disabled" };
  }

  if (!cfg.apiKey?.trim()) {
    setOpenClawHealth("disabled", "missing_api_key", "missing_key");
    logger.info(
      { event: "sync_skipped", provider: "openclaw", reason: "missing_key" },
      "openclaw_sync_skipped",
    );
    return { ok: true, jobsProcessed: 0, dryRun: cfg.dryRun, stopReason: "missing_key" };
  }

  const discoveryService = new DiscoveryService(ctx.companyService);
  let jobsProcessed = 0;
  let page = await readNextPage(redis);
  let hasNext = false;

  logger.info(
    {
      event: "sync_started",
      provider: "openclaw",
      dry_run: cfg.dryRun,
      zero_write_postgres: cfg.dryRun,
      page_start: page,
      max_pages: cfg.maxPagesPerRun,
    },
    "openclaw_sync_started",
  );

  let emittedDryRunSkipLogs = false;
  const shadowSummary = createEmptyOpenClawShadowSummary();

  for (let i = 0; i < cfg.maxPagesPerRun; i++) {
    const fetched = await client.fetchJobsSearch({
      filters: {
        page,
        itemsPerPage: cfg.itemsPerPage,
      },
      includeJobDescription: cfg.enrichmentEnabled,
    });

    await incrOpenClawMetric(redis, "requests", 1);

    if (!fetched.ok) {
      if (fetched.kind === "unauthorized") {
        if (fetched.status === 403) await incrOpenClawMetric(redis, "http_403", 1);
        else await incrOpenClawMetric(redis, "http_401", 1);
      }
      if (fetched.kind === "rate_limited") await incrOpenClawMetric(redis, "http_429", 1);
      if (fetched.kind === "timeout") await incrOpenClawMetric(redis, "timeouts", 1);
      await incrOpenClawMetric(redis, "failures", 1);

      logger.warn(
        {
          event: "openclaw_fetch_failed",
          provider: "openclaw",
          kind: fetched.kind,
          status: fetched.status,
        },
        "openclaw_fetch_failed",
      );
      return { ok: false, jobsProcessed, dryRun: cfg.dryRun, stopReason: fetched.kind };
    }

    const rows = extractJobsArray(fetched.json);
    const meta = fetched.json && typeof fetched.json === "object" && !Array.isArray(fetched.json)
      ? (fetched.json as Record<string, unknown>)
      : {};
    hasNext = Boolean(meta.hasNextPage ?? meta.nextPage ?? meta.has_more);

    if (!rows.length) {
      await writeNextPage(redis, page, false);
      logger.info(
        { event: "openclaw_empty_page", provider: "openclaw", page },
        "openclaw_empty_page",
      );
      break;
    }

    for (const raw of rows) {
      const hints = extractCompanyHints(raw);
      let companyId: string;
      let displayName: string;
      let companyDomain: string;

      if (cfg.dryRun) {
        if (!emittedDryRunSkipLogs) {
          emittedDryRunSkipLogs = true;
          logger.info(
            { event: "openclaw_dry_run_skip_company_resolution", provider: "openclaw" },
            "openclaw_dry_run_skip_company_resolution",
          );
          logger.info(
            { event: "openclaw_dry_run_skip_discovery", provider: "openclaw" },
            "openclaw_dry_run_skip_discovery",
          );
          logger.info(
            { event: "openclaw_dry_run_skip_enrichment", provider: "openclaw" },
            "openclaw_dry_run_skip_enrichment",
          );
        }
        ({ companyId, displayName, companyDomain } = buildOpenClawDryRunCompanyObservation(hints));
      } else {
        try {
          companyId = await resolveCompanyIdForOpenClaw(cfg, ctx.companyService, discoveryService, hints, redis);
        } catch (err) {
          logger.warn(
            { event: "openclaw_company_resolve_failed", provider: "openclaw", err },
            "openclaw_company_resolve_failed",
          );
          await incrOpenClawMetric(redis, "failures", 1);
          continue;
        }

        const companyRow = await ctx.prisma.company.findUnique({
          where: { id: companyId },
          select: { name: true, careersUrl: true },
        });
        displayName = companyRow?.name ?? hints.companyName ?? "Unknown Company";

        if (cfg.enrichmentEnabled) {
          try {
            const merged = await mergeOpenClawHints(ctx.prisma, companyId, hints);
            if (merged) await incrOpenClawMetric(redis, "ats_hints_applied", 1);
          } catch (err) {
            logger.warn(
              { event: "openclaw_hint_merge_failed", provider: "openclaw", companyId, err },
              "openclaw_hint_merge_failed",
            );
          }
        }

        const careersUrl = (
          await ctx.prisma.company.findUnique({
            where: { id: companyId },
            select: { careersUrl: true },
          })
        )?.careersUrl;
        companyDomain = extractCompanyDomain(careersUrl, companyId);
      }

      const mapped = tryMapOpenClawJobToNormalized(raw, companyId, displayName);
      if (!mapped.ok) {
        await incrOpenClawMetric(redis, "malformed_job_rows", 1);
        logger.warn(
          {
            event: "openclaw_mapper_reject",
            provider: "openclaw",
            reason: mapped.reason,
            companyId,
          },
          "openclaw_mapper_reject",
        );
        continue;
      }
      const normalized = mapped.job;

      await incrOpenClawMetric(redis, "jobs_normalized", 1);

      const dedupInput = { ...normalized, companyDomain };

      if (cfg.dryRun) {
        const sim = await simulateDedupOutcome(ctx.jobRepository, dedupInput);
        jobsProcessed += 1;
        if (sim === "idempotent") await incrOpenClawMetric(redis, "jobs_merged", 1);
        else await incrOpenClawMetric(redis, "jobs_new_canonical", 1);
        logger.info(
          {
            event: "openclaw_dry_run_row",
            provider: "openclaw",
            outcome: sim,
            sourceUrl: dedupInput.sourceUrl,
            syntheticCompanyId: true,
          },
          "openclaw_dry_run_row",
        );
        continue;
      }

      try {
        const { inserted, canonical } = await ctx.jobService.ingestDeduplicated(dedupInput);
        jobsProcessed += 1;
        if (!inserted) await incrOpenClawMetric(redis, "jobs_merged", 1);
        else await incrOpenClawMetric(redis, "jobs_new_canonical", 1);

        try {
          const now = new Date();
          const jobRow = await ctx.prisma.job.findUnique({
            where: { id: canonical.id },
            select: {
              id: true,
              status: true,
              title: true,
              sourceUrl: true,
              description: true,
              applyUrl: true,
              parsedDescription: true,
              lastSeenAt: true,
              lastProcessedAt: true,
              contentHash: true,
              companyId: true,
            },
          });
          const companyRow = jobRow
            ? await ctx.prisma.company.findUnique({
                where: { id: jobRow.companyId },
                select: { atsType: true },
              })
            : null;
          const recentSeenBlocks = await peekRecentSeenBlocksEnqueue(
            jobRow?.sourceUrl ?? dedupInput.sourceUrl,
          );
          const shadowEval = evaluateOpenClawShadowParseEligibility(jobRow, {
            now,
            recentSeenBlocks,
          });
          await recordOpenClawShadowParseEval(redis, shadowEval);
          mergeOpenClawShadowEvalIntoSummary(shadowSummary, shadowEval, companyRow?.atsType);

          const descriptionLen = jobRow?.description?.trim().length ?? 0;
          logger.info(
            {
              event: "openclaw_parse_shadow_eval",
              provider: "openclaw",
              canonical_id: canonical.id,
              source_host: sourceUrlHost(jobRow?.sourceUrl ?? dedupInput.sourceUrl),
              company_ats_type: companyRow?.atsType ?? null,
              source: "openclaw",
              inserted,
              eligible: shadowEval.eligible,
              reason: shadowEval.reason,
              processor_would_skip_parse: shadowEval.processorWouldSkipParse,
              description_len: descriptionLen,
            },
            "openclaw_parse_shadow_eval",
          );
        } catch (shadowErr) {
          logger.warn(
            {
              event: "openclaw_parse_shadow_eval_failed",
              provider: "openclaw",
              canonical_id: canonical.id,
              err: shadowErr,
            },
            "openclaw_parse_shadow_eval_failed",
          );
        }
      } catch (err) {
        logger.warn(
          { event: "openclaw_ingest_failed", provider: "openclaw", sourceUrl: dedupInput.sourceUrl, err },
          "openclaw_ingest_failed",
        );
        await incrOpenClawMetric(redis, "failures", 1);
      }
    }

    await writeNextPage(redis, page, hasNext);
    page = hasNext ? page + 1 : 1;
    if (!hasNext) break;
  }

  logger.info(
    {
      event: "sync_completed",
      provider: "openclaw",
      jobsProcessed,
      dry_run: cfg.dryRun,
      hasNext,
    },
    "openclaw_sync_completed",
  );

  if (!cfg.dryRun && shadowSummary.jobs_shadow_evaluated > 0) {
    logger.info(
      {
        event: "openclaw_parse_shadow_summary",
        provider: "openclaw",
        dry_run: cfg.dryRun,
        jobs_shadow_evaluated: shadowSummary.jobs_shadow_evaluated,
        parse_eligible: shadowSummary.parse_eligible,
        parse_ineligible: shadowSummary.parse_ineligible,
        reject_counts: shadowSummary.reject_counts,
        ats_breakdown: shadowSummary.ats_breakdown,
      },
      "openclaw_parse_shadow_summary",
    );
  }

  return { ok: true, jobsProcessed, dryRun: cfg.dryRun };
}
