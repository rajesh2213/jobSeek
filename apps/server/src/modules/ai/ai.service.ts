import axios, { type AxiosInstance } from "axios";
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
  return keys.every((k) => Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string"));
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
    other,
    responsibility: [...parsed.responsibility, ...added.map((l) => l.replace(/^\s*Responsibilities\s*:\s*/i, "").trim())],
  };
}

/** Model often ignores `[OTHER]` hints on company overview; force those lines into `other`. */
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
    requirement: keptReq,
    other: [...parsed.other, ...promoted],
  };
}

function finalizeParsedForPersistence(parsed: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const decoded = decodePersistedParsedLines(parsed);
  const demoted = demoteBoilerplateFromRequirement(decoded);
  return promoteResponsibilityHintLines(demoted);
}

export interface ParseJobDescriptionOptions {
  jobTitle?: string | null;
}

/**
 * Preprocesses description into lines, calls the Python /parse service (batched per line),
 * then applies title fallback when position is empty.
 */
export async function parseJobDescriptionAI(
  description: string,
  client: AxiosInstance = createClient(),
  options?: ParseJobDescriptionOptions,
): Promise<ParsedJobDescriptionAI | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;

  try {
    const lines = preprocessDescription(trimmed);
    const joined = lines.length > 0 ? lines.join("\n") : trimmed;

    const data = await postJobDescriptionParse(joined, client);
    if (data === null) return null;

    if (!isParsedShape(data)) {
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
    }
    applyTitleFallback(parsed, options?.jobTitle);
    return parsed;
  } catch (err) {
    logger.warn(
      { event: "ai_parse_request_failed", err },
      "AI job description parse failed",
    );
    return null;
  }
}

/** When the model/service is unavailable: put trimmed lines into `other` so UI can still render. */
export function fallbackParsedFromDescription(description: string): ParsedJobDescriptionAI {
  const lines = preprocessDescription(description.trim());
  const out = emptyParsedJobDescription();
  if (lines.length) {
    out.other = stripHintPrefixes(lines);
    return finalizeParsedForPersistence(out);
  } else {
    const t = description.trim();
    if (t.length >= 3) {
      out.other = [t.length <= 2500 ? t : `${t.slice(0, 2500)}…`];
    }
  }
  return finalizeParsedForPersistence(out);
}
