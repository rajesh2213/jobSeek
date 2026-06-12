import type { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

export type WorkdayPostedAtHashHitRecoveryInput = {
  sourceUrl: string;
  source: string;
  candidate: Date | undefined;
};

/**
 * Option A+: lightweight postedAt backfill on ATS hash-cache hit.
 * Single conditional UPDATE — no dedup, canonical, or fingerprint reads.
 */
export async function recoverWorkdayPostedAtOnHashCacheHit(
  db: Pick<PrismaClient, "job">,
  input: WorkdayPostedAtHashHitRecoveryInput,
): Promise<number> {
  const { sourceUrl, source, candidate } = input;
  if (source !== "workday") return 0;
  if (!candidate || Number.isNaN(candidate.getTime())) return 0;

  const result = await db.job.updateMany({
    where: {
      sourceUrl,
      source: "workday",
      postedAt: null,
    },
    data: {
      postedAt: candidate,
      effectivePostedAt: candidate,
    },
  });

  const affectedRows = result.count;
  const payload = {
    sourceUrl,
    candidate: candidate.toISOString(),
    affectedRows,
  };

  if (affectedRows > 0) {
    logger.info(
      { event: "workday_postedat_hashhit_recovered", ...payload },
      "workday_postedat_hashhit_recovered",
    );
  } else {
    logger.info(
      { event: "workday_postedat_hashhit_skipped", ...payload },
      "workday_postedat_hashhit_skipped",
    );
  }

  return affectedRows;
}
