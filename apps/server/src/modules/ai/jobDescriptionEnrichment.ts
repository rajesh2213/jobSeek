import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { JobRepository } from "../job/job.repository.js";
import { logger } from "../../utils/logger.js";
import {
  fallbackParsedFromDescription,
  parseJobDescriptionAI,
} from "./ai.service.js";
import { emptyParsedJobDescription } from "./ai.types.js";

function hasUsableParsedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  const keys = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
  ] as const;
  for (const key of keys) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    if (
      value.some(
        (line) => typeof line === "string" && line.replace(/\s+/g, " ").trim().length > 0,
      )
    ) {
      return true;
    }
  }
  return false;
}

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
  try {
    if (!inserted) {
      await jobRepository.promoteJobToReadyIfParsedDescription(
        canonicalId,
        "idempotent_reprocess_parsed_present",
      );
      return;
    }

    await jobRepository.ensureProcessingStatus(canonicalId, "ingest_inserted");
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
      await jobRepository.markJobFailedFromProcessing(canonicalId, "missing_description");
      return;
    }

    const parsed = await parseJobDescriptionAI(desc, undefined, {
      jobTitle: row?.title ?? null,
    });
    const payload = parsed ?? fallbackParsedFromDescription(desc);
    const hasUsableFallback = hasUsableParsedPayload(payload);
    if (!parsed) {
      logger.info(
        {
          event: "parsed_description_fallback_raw_lines",
          canonicalId,
          hasUsableFallback,
        },
        "AI parse unavailable; attempted fallback parsedDescription",
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
      await jobRepository.markJobFailedFromProcessing(canonicalId, "parsed_persist_failed");
      return;
    }

    if (hasUsableFallback) {
      await jobRepository.promoteJobToReady(canonicalId, parsed ? "ai_enriched" : "fallback_enriched");
      return;
    }
    await jobRepository.markJobFailedFromProcessing(canonicalId, "fallback_not_usable");
  } catch (err) {
    logger.error(
      {
        event: "parsed_description_enrichment_failed",
        canonicalId,
        err,
      },
      "Failed during parsedDescription enrichment",
    );
    try {
      await jobRepository.markJobFailedFromProcessing(canonicalId, "enrichment_exception");
    } catch {
      // Best effort only; visibility reconciliation handles transient failures.
    }
  }
}
