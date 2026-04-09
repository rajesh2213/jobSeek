import {
  extractDescriptionFromMainContent,
  extractJsonLdJobPostingStrict,
  extractLocationFallbackFromHtml,
  extractRelaxedTitleFromHtml,
} from "./jobDetailHtml.js";

const MAIN_CONTENT_MIN_LEN = 120;

export type RetryStrategyId = "jsonld_only" | "relaxed_title" | "main_content" | "location_fallback";

export interface RetryContext {
  html: string;
  sourceUrl: string;
  previousReasons: string[];
  /** First-pass validation score; retry is skipped when under 20. */
  initialScore?: number;
  /** Primary extract fields to merge when a strategy only overrides part of the page. */
  primary: {
    title: string | null;
    description: string | null;
    location?: string | null;
  };
}

export interface RetryResult {
  title: string | null;
  description: string | null;
  location?: string | null;
  strategyUsed: RetryStrategyId;
}

function pickStrategy(reasons: string[]): RetryStrategyId | null {
  const r = new Set(reasons);
  if (r.has("json_ld_jobposting")) return "jsonld_only";
  if (r.has("junk_title") || r.has("title_too_short") || r.has("title_length_bad")) return "relaxed_title";
  if (
    r.has("description_too_short") ||
    r.has("description_missing") ||
    r.has("marketing_content") ||
    r.has("marketing_snippet")
  ) {
    return "main_content";
  }
  if (r.has("location_missing")) return "location_fallback";
  return null;
}

/**
 * At most one strategy per call: ordered jsonld_only → relaxed_title → main_content → location_fallback.
 */
export function applyRetryStrategies(ctx: RetryContext): RetryResult | null {
  if (ctx.initialScore !== undefined && ctx.initialScore < 20) return null;

  const strategy = pickStrategy(ctx.previousReasons);
  if (!strategy) return null;

  const { html, primary } = ctx;

  switch (strategy) {
    case "jsonld_only": {
      const j = extractJsonLdJobPostingStrict(html);
      if (!j.hasJobPosting) return null;
      return {
        title: j.title ?? primary.title,
        description: j.description ?? primary.description,
        location: (j.locationLine ?? primary.location) ?? null,
        strategyUsed: "jsonld_only",
      };
    }
    case "relaxed_title": {
      const t = extractRelaxedTitleFromHtml(html);
      if (!t) return null;
      return {
        title: t,
        description: primary.description,
        location: primary.location ?? null,
        strategyUsed: "relaxed_title",
      };
    }
    case "main_content": {
      const text = extractDescriptionFromMainContent(html);
      if (text.length < MAIN_CONTENT_MIN_LEN) return null;
      return {
        title: primary.title,
        description: text,
        location: primary.location ?? null,
        strategyUsed: "main_content",
      };
    }
    case "location_fallback": {
      const loc = extractLocationFallbackFromHtml(html);
      if (!loc) return null;
      return {
        title: primary.title,
        description: primary.description,
        location: loc,
        strategyUsed: "location_fallback",
      };
    }
    default:
      return null;
  }
}
