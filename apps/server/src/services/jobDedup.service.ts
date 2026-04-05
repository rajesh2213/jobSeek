import type { Job } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { DedupJobInput, NormalizedJob } from "../modules/crawler/crawler.types.js";
import type { JobRepository } from "../modules/job/job.repository.js";
import { generateJobFingerprintV2 } from "../utils/jobFingerprint.js";
import { enrichDedupInput } from "../utils/jobTaxonomyEnricher.js";
import { isSameJob, stringSimilarity } from "../utils/jobSimilarity.js";
import { recomputeCanonical } from "./jobCanonical.service.js";
import { logger } from "../utils/logger.js";
import {
  getJobDedupMetricsSnapshot,
  recordIngestionOutcome,
} from "./jobMetrics.service.js";

export type { DedupJobInput } from "../modules/crawler/crawler.types.js";

/**
 * Build v2 fingerprint from normalized job + company domain (cross-ATS stable).
 */
export function fingerprintFromNormalized(input: DedupJobInput): {
  fingerprint: string;
  version: "v2";
} {
  return generateJobFingerprintV2({
    title: input.title,
    companyDomain: input.companyDomain,
    country: input.country,
    isRemote: input.isRemote,
    description: input.description,
    atsJobId: input.atsJobId ?? null,
    applyUrl: input.applyUrl ?? null,
  });
}

function logDedupMetrics(): void {
  const m = getJobDedupMetricsSnapshot();
  logger.info(
    {
      event: "job_dedup_metrics",
      dedupRate: m.dedupRate,
      avgDuplicatesPerCanonical: m.avgDuplicatesPerCanonical,
      canonicalCount: m.canonicalJobsCreated,
      duplicateCount: m.duplicateJobsDetected,
      totalJobsIngested: m.totalJobsIngested,
    },
    "Dedup metrics snapshot",
  );
}

/**
 * Insert or attach duplicate to canonical job by fingerprint. Idempotent for same sourceUrl.
 * Fingerprint match does **not** imply merge — `isSameJob` must pass.
 * Always returns the **canonical** row.
 */
export async function deduplicateAndInsert(
  repo: JobRepository,
  raw: NormalizedJob & { companyDomain: string },
): Promise<{ canonical: Job; inserted: boolean }> {
  const input = enrichDedupInput(raw);
  const { fingerprint, version: fingerprintVersion } = fingerprintFromNormalized(input);

  const existingByUrl = await repo.findBySourceUrl(input.sourceUrl);
  if (existingByUrl) {
    logger.info(
      { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
      "job_duplicate_sourceUrl",
    );
    await repo.updateLastSeenById(existingByUrl.id, new Date());
    const postedMerged = await repo.mergePostedAtIfEarlier(
      existingByUrl.id,
      input.postedAt,
    );
    const canonical = await repo.resolveCanonicalJob(existingByUrl);
    if (postedMerged) {
      await recomputeCanonical(repo, canonical.id);
    }
    recordIngestionOutcome("idempotent");
    logDedupMetrics();
    return { canonical, inserted: false };
  }

  const candidates = await repo.findCanonicalsByFingerprint(fingerprint);

  for (const candidate of candidates) {
    if (
      isSameJob(
        { title: candidate.title, description: candidate.description },
        { title: input.title, description: input.description },
      )
    ) {
      const titleSim = stringSimilarity(candidate.title, input.title);
      const descSim = stringSimilarity(
        candidate.description ?? "",
        input.description ?? "",
      );
      try {
        await repo.createDuplicateJob({
          ...input,
          fingerprint,
          fingerprintVersion,
          canonicalJobId: candidate.id,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          logger.info(
            { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
            "job_duplicate_sourceUrl",
          );
        } else {
          throw err;
        }
      }

      await recomputeCanonical(repo, candidate.id);

      const canonical = await repo.findByIdRaw(candidate.id);
      if (!canonical) {
        throw new Error(`Canonical job missing after dedup: ${candidate.id}`);
      }

      recordIngestionOutcome("duplicate_merged");
      logger.info(
        {
          event: "job_dedup_merge_decision",
          titleA: candidate.title,
          titleB: input.title,
          descSim,
          titleSim,
          reason: "content_match_after_apply_removed",
          fingerprint,
          canonicalId: candidate.id,
          sourceUrl: input.sourceUrl,
        },
        "Duplicate merged into canonical after soft-match",
      );
      logDedupMetrics();
      return { canonical, inserted: true };
    }
  }

  const hadFingerprintCollision = candidates.length > 0;

  let canonical: Job;
  try {
    canonical = await repo.createCanonicalJob({
      ...input,
      fingerprint,
      fingerprintVersion,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      logger.info(
        { event: "job_duplicate_sourceUrl", sourceUrl: input.sourceUrl },
        "job_duplicate_sourceUrl",
      );
      const existing = await repo.findBySourceUrl(input.sourceUrl);
      if (existing) {
        const canonicalExisting = await repo.resolveCanonicalJob(existing);
        recordIngestionOutcome("idempotent");
        logDedupMetrics();
        return { canonical: canonicalExisting, inserted: false };
      }
    }
    throw err;
  }

  recordIngestionOutcome("canonical_new");

  if (hadFingerprintCollision) {
    logger.info(
      {
        event: "job_dedup_collision_avoided",
        fingerprint,
        canonicalId: canonical.id,
        sourceUrl: input.sourceUrl,
        conflictingCanonicalCount: candidates.length,
      },
      "Fingerprint collision avoided — new canonical created (not a soft-match duplicate)",
    );
  } else {
    logger.info(
      {
        event: "job_canonical_created",
        fingerprint,
        canonicalId: canonical.id,
        sourceUrl: input.sourceUrl,
      },
      "New canonical job created",
    );
  }

  logDedupMetrics();
  return { canonical, inserted: true };
}
