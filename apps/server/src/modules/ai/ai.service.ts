import { createHash } from "node:crypto";
import axios, { type AxiosInstance } from "axios";
import { getIoredis } from "../../queues/job.queue.js";
import { logger } from "../../utils/logger.js";
import {
  emptyParsedJobDescription,
  type ParsedJobDescriptionAI,
} from "./ai.types.js";
import {
  decodePersistedParsedLines,
  postJobDescriptionParse,
  stripHintPrefixes,
  stripParsedDescriptionHints,
} from "./jobParser.service.js";
import {
  lineMatchesCompanyBoilerplate,
  preprocessDescription,
} from "./preprocessDescription.js";

const DEFAULT_URL = "http://localhost:8001";

export const BUCKET_LINE_CAP = 50;

const CACHE_KEY_MAX_CHARS = 20_000;
const PARSE_CACHE_KEY_PREFIX = "parse:v1";

function parseCacheEnabled(): boolean {
  return process.env.PARSE_CACHE_ENABLED !== "0" && process.env.PARSE_CACHE_ENABLED !== "false";
}

function getParseCacheTtlSec(): number {
  const n = Number(process.env.PARSE_CACHE_TTL_SEC ?? "86400");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 86_400;
}

function getMaxInFlightParse(): number {
  const n = Number(process.env.MAX_IN_FLIGHT_PARSE ?? "6");
  return Math.max(1, Math.min(32, Number.isFinite(n) ? n : 6));
}

class Limiter {
  private running = 0;
  private readonly wait: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      if (this.running < this.max) {
        this.running += 1;
        resolve();
      } else {
        this.wait.push(() => {
          this.running += 1;
          resolve();
        });
      }
    });
    try {
      return await fn();
    } finally {
      this.running -= 1;
      const next = this.wait.shift();
      if (next) next();
    }
  }
}

const parseInFlight = new Limiter(getMaxInFlightParse());

function getBaseUrl(): string {
  return (
    process.env.AI_JOB_PARSER_URL?.trim() ||
    process.env.JOB_PARSER_SERVICE_URL?.trim() ||
    DEFAULT_URL
  );
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: getBaseUrl().replace(/\/$/, ""),
    timeout: Number(process.env.AI_JOB_PARSER_TIMEOUT_MS ?? 120_000),
    headers: { "Content-Type": "application/json" },
  });
}

function isParsedShape(v: unknown): v is ParsedJobDescriptionAI {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const keys = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
  ] as const;
  return keys.every(
    (k) => Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string"),
  );
}

function isParsedEffectivelyEmpty(p: ParsedJobDescriptionAI): boolean {
  return (
    p.position.length === 0 &&
    p.responsibility.length === 0 &&
    p.requirement.length === 0 &&
    p.experience.length === 0 &&
    p.benefit.length === 0 &&
    p.contact.length === 0 &&
    p.other.length === 0
  );
}

function applyTitleFallback(parsed: ParsedJobDescriptionAI, jobTitle?: string | null): void {
  const t = jobTitle?.trim();
  if (t && parsed.position.length === 0) {
    parsed.position.push(t);
  }
}

/** Lines: requirement / responsibility / benefit — used for observability (no retry on low score). */
export function computeParseConfidence(parsed: ParsedJobDescriptionAI): number {
  const buckets = [parsed.requirement, parsed.responsibility, parsed.benefit];
  const filled = buckets.filter((arr) => arr.length > 0).length;
  return filled / buckets.length;
}

/**
 * Text identity for cache keys: not raw preprocessed "joined"; stable across trivial whitespace.
 */
export function normalizeDescriptionForCacheKey(description: string): string {
  const t = description.trim().replace(/\s+/g, " ");
  return t.length > CACHE_KEY_MAX_CHARS ? t.slice(0, CACHE_KEY_MAX_CHARS) : t;
}

function cacheKeyV1(description: string): string {
  const material = normalizeDescriptionForCacheKey(description);
  const hash = createHash("sha256").update(material, "utf8").digest("hex");
  return `${PARSE_CACHE_KEY_PREFIX}:${hash}`;
}

function capBucketLines(lines: string[], cap: number = BUCKET_LINE_CAP): string[] {
  if (lines.length <= cap) return lines;
  return lines.slice(0, cap);
}

/**
 * Heuristic line routing when the model is unavailable. Caps each of the seven buckets.
 */
function smartFallbackDistributeRawLines(
  lines: string[],
  cap: number = BUCKET_LINE_CAP,
): ParsedJobDescriptionAI {
  const out: ParsedJobDescriptionAI = {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
  const reqRe = /\b(req(?:uirements?)?|qualif(?:ications?)?|must\s+have|should\s+have|skills?)\b/i;
  const respRe = /\b(responsib|what\s+you(?:'ll| will)\s+do|duties|day-to-day|key\s+role)\b/i;
  const benRe = /\b(benefit|perk|compensation|we\s+offer|health\s*insurance|401|pto|vacation|equity|salary|pay\s*range)\b/i;
  const expRe = /\b(experience|years?\s+of|bachelor|master|degree|phd|education)\b/i;
  const conRe = /\b(contact|email|@|phone|apply|reach\s+us)\b/i;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (out.requirement.length < cap && reqRe.test(line)) {
      out.requirement.push(line);
    } else if (out.responsibility.length < cap && respRe.test(line)) {
      out.responsibility.push(line);
    } else if (out.benefit.length < cap && benRe.test(line)) {
      out.benefit.push(line);
    } else if (out.experience.length < cap && expRe.test(line)) {
      out.experience.push(line);
    } else if (out.contact.length < cap && conRe.test(line)) {
      out.contact.push(line);
    } else if (out.other.length < cap) {
      out.other.push(line);
    }
  }
  return out;
}

/** Lines we prefixed with "Responsibilities:" in preprocess; move from `other` if the model still mis-buckets. */
function promoteResponsibilityHintLines(parsed: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const hint = /^\s*Responsibilities\s*:/i;
  const promoted = parsed.other.filter((l) => hint.test(l));
  const other = parsed.other.filter((l) => !hint.test(l));
  const seen = new Set(parsed.responsibility.map((x) => x.toLowerCase()));
  const added = promoted.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    ...parsed,
    other: capBucketLines(
      other,
      BUCKET_LINE_CAP,
    ),
    responsibility: capBucketLines(
      [...parsed.responsibility, ...added.map((l) => l.replace(/^\s*Responsibilities\s*:\s*/i, "").trim())],
      BUCKET_LINE_CAP,
    ),
  };
}

function demoteBoilerplateFromRequirement(parsed: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const keptReq: string[] = [];
  const promoted: string[] = [];
  const seenOther = new Set(parsed.other.map((x) => x.toLowerCase()));
  for (const line of parsed.requirement) {
    if (lineMatchesCompanyBoilerplate(line)) {
      const k = line.toLowerCase();
      if (!seenOther.has(k)) {
        seenOther.add(k);
        promoted.push(line);
      }
    } else {
      keptReq.push(line);
    }
  }
  return {
    ...parsed,
    requirement: capBucketLines(keptReq, BUCKET_LINE_CAP),
    other: capBucketLines([...parsed.other, ...promoted], BUCKET_LINE_CAP),
  };
}

function finalizeParsedForPersistence(parsed: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const decoded = decodePersistedParsedLines(parsed);
  const demoted = demoteBoilerplateFromRequirement(decoded);
  return capAllBuckets(
    promoteResponsibilityHintLines(demoted),
    BUCKET_LINE_CAP,
  );
}

function capAllBuckets(
  p: ParsedJobDescriptionAI,
  cap: number,
): ParsedJobDescriptionAI {
  return {
    position: capBucketLines(p.position, cap),
    responsibility: capBucketLines(p.responsibility, cap),
    requirement: capBucketLines(p.requirement, cap),
    experience: capBucketLines(p.experience, cap),
    benefit: capBucketLines(p.benefit, cap),
    contact: capBucketLines(p.contact, cap),
    other: capBucketLines(p.other, cap),
  };
}

function logParseFailure(
  reason: "http_error" | "invalid_shape" | "fallback" | "cache_error",
  extra?: Record<string, unknown>,
): void {
  logger.info({ event: "parse_failure", reason, ...extra }, "parse_failure");
}

export interface ParseJobDescriptionOptions {
  jobTitle?: string | null;
}

function cloneParsed(p: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  return {
    position: [...p.position],
    responsibility: [...p.responsibility],
    requirement: [...p.requirement],
    experience: [...p.experience],
    benefit: [...p.benefit],
    contact: [...p.contact],
    other: [...p.other],
  };
}

/**
 * Preprocesses description, /parse (in-flight–limited), optional Redis cache, then post-processes.
 */
export async function parseJobDescriptionAI(
  description: string,
  client: AxiosInstance = createClient(),
  options?: ParseJobDescriptionOptions,
): Promise<ParsedJobDescriptionAI | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;

  const key = cacheKeyV1(description);

  if (parseCacheEnabled()) {
    let cacheHit: boolean | null = null;
    try {
      const redis = getIoredis();
      const raw = await redis.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw)) as unknown;
          if (isParsedShape(parsed)) {
            const fromCache: ParsedJobDescriptionAI = {
              position: capBucketLines(parsed.position, BUCKET_LINE_CAP),
              responsibility: capBucketLines(parsed.responsibility, BUCKET_LINE_CAP),
              requirement: capBucketLines(parsed.requirement, BUCKET_LINE_CAP),
              experience: capBucketLines(parsed.experience, BUCKET_LINE_CAP),
              benefit: capBucketLines(parsed.benefit, BUCKET_LINE_CAP),
              contact: capBucketLines(parsed.contact, BUCKET_LINE_CAP),
              other: capBucketLines(parsed.other, BUCKET_LINE_CAP),
            };
            const out = cloneParsed(fromCache);
            applyTitleFallback(out, options?.jobTitle);
            cacheHit = true;
            logger.info(
              { event: "parse_cache", hit: true, version: "v1", source: "redis" },
              "parse_cache",
            );
            return out;
          }
        } catch (err) {
          logParseFailure("cache_error", { err, stage: "json_parse" });
        }
        cacheHit = false;
      } else {
        cacheHit = false;
      }
    } catch (err) {
      logParseFailure("cache_error", { err, stage: "get" });
      cacheHit = false;
    }
    if (cacheHit === false) {
      logger.info(
        { event: "parse_cache", hit: false, version: "v1", source: "redis" },
        "parse_cache",
      );
    }
  }

  const lines = preprocessDescription(trimmed);
  const joined = lines.length > 0 ? lines.join("\n") : trimmed;
  const lineCount = lines.length;

  let data: unknown;
  const httpStart = Date.now();
  try {
    data = await parseInFlight.use(() => postJobDescriptionParse(joined, client));
  } catch (err) {
    logParseFailure("http_error", { err });
    logger.warn(
      { event: "ai_parse_request_failed", err },
      "AI job description parse failed",
    );
    logger.info(
      {
        event: "ai_parse_latency",
        durationMs: Date.now() - httpStart,
        lineCount,
        descriptionCharCount: joined.length,
      },
      "ai_parse_latency",
    );
    return null;
  }
  logger.info(
    {
      event: "ai_parse_latency",
      durationMs: Date.now() - httpStart,
      lineCount,
      descriptionCharCount: joined.length,
    },
    "ai_parse_latency",
  );

  if (data === null) {
    logParseFailure("fallback", { reason: "empty_response" });
    return null;
  }

  if (!isParsedShape(data)) {
    logParseFailure("invalid_shape");
    logger.warn(
      { event: "ai_parse_invalid_shape" },
      "AI parse response shape invalid",
    );
    return null;
  }

  let parsed: ParsedJobDescriptionAI = finalizeParsedForPersistence(
    stripParsedDescriptionHints(data),
  );
  if (isParsedEffectivelyEmpty(parsed)) {
    parsed = fallbackParsedFromDescription(description);
    logParseFailure("fallback", { source: "model_empty" });
  }
  const beforeTitle = cloneParsed(parsed);
  applyTitleFallback(parsed, options?.jobTitle);

  if (parseCacheEnabled() && !isParsedEffectivelyEmpty(beforeTitle)) {
    try {
      const redis = getIoredis();
      await redis.set(
        key,
        JSON.stringify(beforeTitle),
        "EX",
        getParseCacheTtlSec(),
      );
    } catch (err) {
      logParseFailure("cache_error", { err, stage: "set" });
    }
  }

  return parsed;
}

export function fallbackParsedFromDescription(description: string): ParsedJobDescriptionAI {
  const lines = preprocessDescription(description.trim());
  const out = emptyParsedJobDescription();
  if (lines.length) {
    const stripped = stripHintPrefixes(lines);
    const distributed = smartFallbackDistributeRawLines(stripped, BUCKET_LINE_CAP);
    Object.assign(out, capAllBuckets(distributed, BUCKET_LINE_CAP));
    return finalizeParsedForPersistence(out);
  } else {
    const t = description.trim();
    if (t.length >= 3) {
      const chunk = t.length <= 2500 ? t : `${t.slice(0, 2500)}…`;
      out.other = capBucketLines([chunk], BUCKET_LINE_CAP);
    }
  }
  return finalizeParsedForPersistence(out);
}
