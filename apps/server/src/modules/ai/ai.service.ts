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

const PARSE_CACHE_KEY_PREFIX = "parse:v1";

/** Short-term marker (separate from long-term v1 value TTL): another worker may skip HTTP if v1 is still present. */
const PARSE_BURST_KEY_PREFIX = "parse:burst:recent";

const CACHE_IDENTITY_LOG_FIRST = 200;
let cacheIdentityLogCount = 0;
function shouldLogCacheIdentityCheck(): boolean {
  cacheIdentityLogCount += 1;
  if (cacheIdentityLogCount <= CACHE_IDENTITY_LOG_FIRST) return true;
  return Math.random() < 0.01;
}

let parseStartsInWindow = 0;

/**
 * In-process counter reset by the job worker with each `worker_queue_snapshot` (≈1/min).
 * Sum across all job-worker processes to approximate total parse starts/min.
 */
export function takeAndResetParseStartsInWindow(): number {
  const n = parseStartsInWindow;
  parseStartsInWindow = 0;
  return n;
}

function parseCacheEnabled(): boolean {
  return process.env.PARSE_CACHE_ENABLED !== "0" && process.env.PARSE_CACHE_ENABLED !== "false";
}

function getParseCacheTtlSec(): number {
  const n = Number(process.env.PARSE_CACHE_TTL_SEC ?? "86400");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 86_400;
}

/**
 * Limiter for concurrent HTTP /parse calls. Safe to tune 4 → 5 → 6: monitor `ai_parse_latency`
 * p95; revert if it rises while load is flat.
 * @see apps/server .env MAX_IN_FLIGHT_PARSE
 */
function getMaxInFlightParse(): number {
  const n = Number(process.env.MAX_IN_FLIGHT_PARSE ?? "6");
  return Math.max(1, Math.min(6, Number.isFinite(n) ? n : 6));
}

/** Short burst dedupe window (s). 0 = off. Uses Redis marker + existing v1 key read (no change to long-term cache semantics). */
function getParseBurstRecentTtlSec(): number {
  const n = Number(process.env.PARSE_BURST_DEDUPE_TTL_SEC ?? "0");
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(3_600, Math.floor(n));
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
 * Same text the LLM/parse service receives: preprocessed lines joined with newlines, or the trimmed
 * original when preprocess yields no lines. Used for the v1 cache key and burst dedupe.
 */
function buildLlmParseInput(description: string): {
  trimmed: string;
  preprocessed: string;
  lineCount: number;
} {
  const trimmed = description.trim();
  if (!trimmed) {
    return { trimmed: "", preprocessed: "", lineCount: 0 };
  }
  const lines = preprocessDescription(trimmed);
  const preprocessed = lines.length > 0 ? lines.join("\n") : trimmed;
  return { trimmed, preprocessed, lineCount: lines.length };
}

export function normalizeDescriptionForCacheKey(s: string): string {
  return s.trim().replace(/\r\n/g, "\n");
}

function cacheKeyV1FromPreprocessed(preprocessed: string): string {
  const normalized = normalizeDescriptionForCacheKey(preprocessed);
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${PARSE_CACHE_KEY_PREFIX}:${hash}`;
}

/**
 * If another parse completed recently for the same description text, resolve from existing v1 Redis
 * value and skip the HTTP /parse call (separate from long-term cache; requires PARSE_BURST_DEDUPE_TTL_SEC>0).
 */
export async function tryParseFromBurstRecent(
  description: string,
  options?: ParseJobDescriptionOptions,
): Promise<ParsedJobDescriptionAI | null> {
  if (getParseBurstRecentTtlSec() <= 0 || !parseCacheEnabled()) return null;
  const { trimmed, preprocessed } = buildLlmParseInput(description);
  if (!trimmed) return null;

  let redis: ReturnType<typeof getIoredis>;
  try {
    redis = getIoredis();
  } catch {
    return null;
  }

  const v1key = cacheKeyV1FromPreprocessed(preprocessed);
  const hash = v1key.slice(v1key.lastIndexOf(":") + 1);
  const burstKey = `${PARSE_BURST_KEY_PREFIX}:${hash}`;

  try {
    if (!(await redis.get(burstKey))) return null;
    const raw = await redis.get(v1key);
    if (!raw) {
      await redis.del(burstKey).catch(() => undefined);
      return null;
    }
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!isParsedShape(parsed)) return null;
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
    if (isParsedEffectivelyEmpty(out)) return null;
    logger.info(
      {
        event: "parse_burst_dedupe_skip",
        id: options?.canonicalJobId ?? null,
        version: "v1",
      },
      "parse_burst_dedupe_skip",
    );
    return out;
  } catch (err) {
    logParseFailure("cache_error", { err, stage: "parse_burst_dedupe" });
    return null;
  }
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
  /** Canonical Job id for parse/cache visibility logs. */
  canonicalJobId?: string | null;
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
 * (Future: batching N descriptions in one /parse in jobParser is the largest throughput win.)
 */
export async function parseJobDescriptionAI(
  description: string,
  client: AxiosInstance = createClient(),
  options?: ParseJobDescriptionOptions,
): Promise<ParsedJobDescriptionAI | null> {
  const { trimmed, preprocessed, lineCount } = buildLlmParseInput(description);
  if (!trimmed) return null;

  const key = cacheKeyV1FromPreprocessed(preprocessed);
  logger.info(
    {
      event: "cache_key_debug",
      jobId: options?.canonicalJobId ?? null,
      key,
      length: preprocessed.length,
    },
    "cache_key_debug",
  );
  if (shouldLogCacheIdentityCheck()) {
    logger.info(
      {
        event: "cache_identity_check",
        key,
        preview: preprocessed.slice(0, 100),
      },
      "cache_identity_check",
    );
  }

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
              {
                event: "parse_cache",
                hit: true,
                id: options?.canonicalJobId ?? null,
                version: "v1",
                source: "redis",
              },
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
        {
          event: "parse_cache",
          hit: false,
          id: options?.canonicalJobId ?? null,
          version: "v1",
          source: "redis",
        },
        "parse_cache",
      );
    }
  }

  let data: unknown;
  const httpStart = Date.now();
  try {
    data = await parseInFlight.use(async () => {
      parseStartsInWindow += 1;
      return await postJobDescriptionParse(preprocessed, client);
    });
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
        descriptionCharCount: preprocessed.length,
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
      descriptionCharCount: preprocessed.length,
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
      const burstTtl = getParseBurstRecentTtlSec();
      if (burstTtl > 0) {
        const hash = key.slice(key.lastIndexOf(":") + 1);
        await redis.set(`${PARSE_BURST_KEY_PREFIX}:${hash}`, "1", "EX", burstTtl);
      }
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
