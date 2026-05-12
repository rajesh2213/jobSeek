import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { JobRepository } from "../job/job.repository.js";
import { logger } from "../../utils/logger.js";
import {
  fallbackParsedFromDescription,
  parseJobDescriptionAI,
  tryParseFromBurstRecent,
} from "./ai.service.js";
import { emptyParsedJobDescription } from "./ai.types.js";

const BUCKET_KEYS = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
] as const;

/** True when `parsedDescription` is SQL NULL, JSON `null`, or a sentinel, not a real struct. */
function isNullishParsedField(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === Prisma.JsonNull) return true;
  if (value === Prisma.DbNull) return true;
  return false;
}

/**
 * Stricter than plain truthiness: JSON `null`, empty object, and all-empty bucket arrays
 * are **not** usable; at least one bucket must contain a non-blank string line.
 * Exported for OpenClaw shadow eligibility (read-only; must stay aligned with enrich skips).
 */
export function hasUsableParsedPayloadStrict(payload: unknown): boolean {
  if (isNullishParsedField(payload)) return false;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const obj = payload as Record<string, unknown>;
  for (const key of BUCKET_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) continue;
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
 * After ingest, run AI parse and persist `parsedDescription`.
 * For idempotent re-ingest (same sourceUrl, `inserted: false`), skips when a usable
 * `parsedDescription` is already present; otherwise runs parse to repair / backfill.
 * Does not run in the API server — only workers / scripts.
 */
export async function enrichCanonicalJobParsedDescription(
  prisma: PrismaClient,
  jobRepository: JobRepository,
  canonicalId: string,
  inserted: boolean,
): Promise<void> {
  try {
    const row = await prisma.job.findUnique({
      where: { id: canonicalId },
      select: { description: true, title: true, parsedDescription: true },
    });

    const usableParsed = hasUsableParsedPayloadStrict(row?.parsedDescription);

    if (!inserted && usableParsed) {
      return;
    }
    if (!inserted) {
      /* Same sourceUrl re-ingest but missing / empty parse — need AI/fallback. */
      logger.info(
        { event: "parse_repair_idempotent_ingest", canonicalId, reason: "missing_or_empty_parsed" },
        "idempotent re-ingest: running parse (parsedDescription not usable yet)",
      );
    }

    await jobRepository.ensureProcessingStatus(
      canonicalId,
      inserted ? "ingest_inserted" : "idempotent_repair_parsed",
    );
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

    const fromBurst = await tryParseFromBurstRecent(desc, {
      jobTitle: row?.title ?? null,
      canonicalJobId: canonicalId,
    });
    const parsed =
      fromBurst ??
      (await parseJobDescriptionAI(desc, undefined, {
        jobTitle: row?.title ?? null,
        canonicalJobId: canonicalId,
      }));
    const payload = parsed ?? fallbackParsedFromDescription(desc);
    const hasUsableFallback = hasUsableParsedPayloadStrict(payload);
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
