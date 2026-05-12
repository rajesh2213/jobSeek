import { hasUsableParsedPayloadStrict } from "../../../ai/jobDescriptionEnrichment.js";
import { computeJobContentHash } from "../../../../utils/jobContentHash.js";
import { normalizeJobUrl } from "../../../../utils/normalizeJobUrl.js";

/** Matches `job.processor.ts` PROCESSING_LOOKBACK_DAYS default. */
function processingLookbackDays(): number {
  return Math.max(1, Number(process.env.PROCESSING_LOOKBACK_DAYS ?? "7") || 7);
}

export function openClawShadowMinDescriptionChars(): number {
  const n = Number(process.env.OPENCLAW_SHADOW_MIN_DESCRIPTION_CHARS ?? "48") || 48;
  return Math.max(16, Math.min(2000, Math.floor(n)));
}

export function processingLookbackSince(nowMs = Date.now()): Date {
  return new Date(nowMs - processingLookbackDays() * 24 * 60 * 60 * 1000);
}

export type OpenClawShadowParseRejectReason =
  | "eligible"
  | "canonical_row_missing"
  | "failed_status"
  | "existing_usable_parse"
  | "missing_description"
  | "description_too_short"
  | "missing_source_url"
  | "outside_lookback_window"
  | "no_reprocessing_needed"
  | "content_unchanged"
  | "recent_seen_dedupe_window";

export type OpenClawShadowJobRow = {
  id: string;
  status: string | null;
  title: string;
  sourceUrl: string;
  description: string | null;
  applyUrl: string | null;
  parsedDescription: unknown;
  lastSeenAt: Date | null;
  lastProcessedAt: Date | null;
  contentHash: string | null;
};

export type OpenClawShadowEvalResult = {
  eligible: boolean;
  reason: OpenClawShadowParseRejectReason;
  /** Mirrors job worker: would run enrich when all true. */
  processorWouldSkipParse: boolean;
};

/**
 * Shadow-only: whether a canonical **would** pass the same gates as `PROCESS_JOB` parse
 * (lookback, needsProcessing, content hash) plus safe-parse preconditions (description, not failed).
 * Does not read Redis — pass `recentSeenBlocks` from `peekRecentSeenBlocksEnqueue`.
 */
export function evaluateOpenClawShadowParseEligibility(
  row: OpenClawShadowJobRow | null,
  input: {
    now: Date;
    recentSeenBlocks: boolean;
  },
): OpenClawShadowEvalResult {
  const minDesc = openClawShadowMinDescriptionChars();
  const lookbackSince = processingLookbackSince(input.now.getTime());

  if (!row) {
    return {
      eligible: false,
      reason: "canonical_row_missing",
      processorWouldSkipParse: true,
    };
  }

  if (!row.sourceUrl?.trim()) {
    return {
      eligible: false,
      reason: "missing_source_url",
      processorWouldSkipParse: true,
    };
  }

  if (row.status === "failed") {
    return {
      eligible: false,
      reason: "failed_status",
      processorWouldSkipParse: true,
    };
  }

  if (hasUsableParsedPayloadStrict(row.parsedDescription)) {
    return {
      eligible: false,
      reason: "existing_usable_parse",
      processorWouldSkipParse: true,
    };
  }

  const desc = row.description?.trim() ?? "";
  if (!desc) {
    return {
      eligible: false,
      reason: "missing_description",
      processorWouldSkipParse: true,
    };
  }

  if (desc.length < minDesc) {
    return {
      eligible: false,
      reason: "description_too_short",
      processorWouldSkipParse: true,
    };
  }

  const lastSeen = row.lastSeenAt;
  const withinWindow = lastSeen != null && lastSeen >= lookbackSince;
  if (!withinWindow) {
    return {
      eligible: false,
      reason: "outside_lookback_window",
      processorWouldSkipParse: true,
    };
  }

  const lastProcessed = row.lastProcessedAt;
  const needsProcessing =
    lastProcessed == null || lastSeen!.getTime() > lastProcessed.getTime();
  if (!needsProcessing) {
    return {
      eligible: false,
      reason: "no_reprocessing_needed",
      processorWouldSkipParse: true,
    };
  }

  const newContentHash = computeJobContentHash({
    title: row.title,
    description: row.description,
    applyUrl: row.applyUrl ?? row.sourceUrl,
  });

  if (row.contentHash != null && row.contentHash === newContentHash) {
    return {
      eligible: false,
      reason: "content_unchanged",
      processorWouldSkipParse: true,
    };
  }

  if (input.recentSeenBlocks) {
    return {
      eligible: false,
      reason: "recent_seen_dedupe_window",
      processorWouldSkipParse: true,
    };
  }

  return {
    eligible: true,
    reason: "eligible",
    processorWouldSkipParse: false,
  };
}

export function sourceUrlHost(sourceUrl: string): string | null {
  const t = sourceUrl.trim();
  if (!t) return null;
  try {
    const u = new URL(normalizeJobUrl(t));
    return u.hostname || null;
  } catch {
    return null;
  }
}

export type OpenClawShadowSummary = {
  jobs_shadow_evaluated: number;
  parse_eligible: number;
  parse_ineligible: number;
  reject_counts: Partial<Record<OpenClawShadowParseRejectReason, number>>;
  /** atsType key (trimmed or "unknown") */
  ats_breakdown: Record<string, { eligible: number; ineligible: number }>;
};

export function createEmptyOpenClawShadowSummary(): OpenClawShadowSummary {
  return {
    jobs_shadow_evaluated: 0,
    parse_eligible: 0,
    parse_ineligible: 0,
    reject_counts: {},
    ats_breakdown: {},
  };
}

export function mergeOpenClawShadowEvalIntoSummary(
  summary: OpenClawShadowSummary,
  evalResult: OpenClawShadowEvalResult,
  companyAtsType: string | null | undefined,
): void {
  summary.jobs_shadow_evaluated += 1;
  if (evalResult.eligible) {
    summary.parse_eligible += 1;
  } else {
    summary.parse_ineligible += 1;
  }
  const r = evalResult.reason;
  summary.reject_counts[r] = (summary.reject_counts[r] ?? 0) + 1;

  const atsKey = (companyAtsType ?? "").trim() || "unknown";
  if (!summary.ats_breakdown[atsKey]) {
    summary.ats_breakdown[atsKey] = { eligible: 0, ineligible: 0 };
  }
  const bucket = summary.ats_breakdown[atsKey]!;
  if (evalResult.eligible) bucket.eligible += 1;
  else bucket.ineligible += 1;
}
