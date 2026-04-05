import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { JobRepository } from "../job/job.repository.js";
import { logger } from "../../utils/logger.js";
import {
  fallbackParsedFromDescription,
  parseJobDescriptionAI,
} from "./ai.service.js";
import { emptyParsedJobDescription } from "./ai.types.js";

/**
 * After a successful ingest that may have changed canonical description, run AI parse
 * and persist `parsedDescription`. Skips when ingest was idempotent (same sourceUrl).
 * Does not run in the API server — only workers / scripts.
 */
export async function enrichCanonicalJobParsedDescription(
  prisma: PrismaClient,
  jobRepository: JobRepository,
  canonicalId: string,
  inserted: boolean,
): Promise<void> {
  if (!inserted) return;

  const row = await prisma.job.findUnique({
    where: { id: canonicalId },
    select: { description: true, title: true },
  });
  const desc = row?.description?.trim();
  if (!desc) {
    try {
      await jobRepository.updateParsedDescription(
        canonicalId,
        emptyParsedJobDescription() as unknown as Prisma.InputJsonValue,
      );
    } catch (err) {
      logger.error(
        { event: "parsed_description_empty_desc_persist_failed", canonicalId, err },
        "Failed to persist empty parsedDescription",
      );
    }
    return;
  }

  const parsed = await parseJobDescriptionAI(desc, undefined, {
    jobTitle: row?.title ?? null,
  });
  const payload = parsed ?? fallbackParsedFromDescription(desc);
  if (!parsed) {
    logger.info(
      { event: "parsed_description_fallback_raw_lines", canonicalId },
      "AI parse unavailable; stored line fallback in parsedDescription.other",
    );
  }

  try {
    await jobRepository.updateParsedDescription(
      canonicalId,
      payload as unknown as Prisma.InputJsonValue,
    );
  } catch (err) {
    logger.error(
      {
        event: "parsed_description_persist_failed",
        canonicalId,
        err,
      },
      "Failed to persist parsedDescription",
    );
  }
}
