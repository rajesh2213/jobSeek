import type { NormalizedJob } from "../../../crawler/crawler.types.js";
import { inferRemote, parseDate, sanitizeHtml, trimWhitespace } from "../../../ats/ats.interface.js";
import { normalizeJobUrl } from "../../../../utils/normalizeJobUrl.js";
import type { OpenClawJobCompanyHints } from "./openclaw.types.js";
import { isValidJobUrl } from "../../../../utils/url.js";
import { logger } from "../../../../utils/logger.js";

/** Local OpenClaw-only limits — no global validation framework. */
export const OPENCLAW_MAX_TITLE_LEN = 500;
export const OPENCLAW_MAX_LOCATION_LEN = 500;
export const OPENCLAW_MAX_DESCRIPTION_LEN = 200_000;
export const OPENCLAW_MAX_ATS_JOB_ID_LEN = 256;
export const OPENCLAW_MAX_URL_INPUT_LEN = 4096;
export const OPENCLAW_MAX_HINT_STRING_LEN = 512;

/** Machine-safe reject reasons for metrics + logs (no raw payload). */
export type OpenClawMapRejectReason =
  | "not_object"
  | "missing_title_or_url"
  | "invalid_listing_url"
  | "invalid_apply_url"
  | "title_empty_after_trim"
  | "field_length_exceeded";

export type MapOpenClawJobResult =
  | { ok: true; job: NormalizedJob }
  | { ok: false; reason: OpenClawMapRejectReason };

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function extractJobsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const r = asRecord(parsed);
  if (!r) return [];
  const jobs =
    r.jobs ?? r.jobOpenings ?? r.data ?? r.results ?? r.items ?? r.records;
  if (Array.isArray(jobs)) return jobs;
  return [];
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max);
}

/**
 * Accept http(s) listing URLs only; normalize to canonical form used by dedup.
 */
export function coerceOpenClawListingUrl(raw: string): string | null {
  const t = truncate(raw.trim(), OPENCLAW_MAX_URL_INPUT_LEN);
  if (!t) return null;
  let candidate = t;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  if (!isValidJobUrl(candidate)) return null;
  try {
    const normalized = normalizeJobUrl(candidate);
    if (!normalized || normalized.length > OPENCLAW_MAX_URL_INPUT_LEN) return null;
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return null;
    return normalized;
  } catch {
    return null;
  }
}

function coerceOptionalApplyUrl(raw: string | undefined): { ok: true; url?: string } | { ok: false } {
  if (raw === undefined || raw === null || !String(raw).trim()) {
    return { ok: true, url: undefined };
  }
  const t = truncate(String(raw).trim(), OPENCLAW_MAX_URL_INPUT_LEN);
  if (!isValidJobUrl(t)) return { ok: false };
  try {
    const normalized = normalizeJobUrl(t);
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return { ok: false };
    return { ok: true, url: normalized };
  } catch {
    return { ok: false };
  }
}

const POSTED_AT_MIN_MS = Date.UTC(1980, 0, 1);
function postedAtUpperBoundMs(): number {
  return Date.now() + 366 * 24 * 60 * 60 * 1000;
}

/**
 * Parse optional post date; returns undefined for missing/invalid — never throws.
 * Grossly invalid numeric timestamps are ignored (job still ingests without postedAt).
 */
export function safeOpenClawPostedAt(
  r: Record<string, unknown>,
  postedRaw: string | undefined,
): Date | undefined {
  if (postedRaw?.trim()) {
    const d = parseDate(postedRaw.trim());
    if (d) {
      const t = d.getTime();
      if (!Number.isNaN(t) && t >= POSTED_AT_MIN_MS && t <= postedAtUpperBoundMs()) return d;
    }
  }
  if (typeof r.postedAt === "number" && Number.isFinite(r.postedAt)) {
    let ms = r.postedAt;
    if (ms > 0 && ms < 1e11) ms *= 1000;
    const d = new Date(ms);
    const t = d.getTime();
    if (!Number.isNaN(t) && t >= POSTED_AT_MIN_MS && t <= postedAtUpperBoundMs()) return d;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNestedString(obj: Record<string, unknown>, path: string[]): string | null {
  let cur: unknown = obj;
  for (const p of path) {
    const rec = asRecord(cur);
    if (!rec) return null;
    cur = rec[p];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
}

function safeHintString(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.trim()) return undefined;
  return truncate(raw.trim(), OPENCLAW_MAX_HINT_STRING_LEN);
}

function safeCareersUrlHint(raw: string | undefined): string | undefined {
  const s = safeHintString(raw);
  if (!s) return undefined;
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  if (!isValidJobUrl(candidate)) return undefined;
  return truncate(candidate, OPENCLAW_MAX_URL_INPUT_LEN);
}

export function extractCompanyHints(raw: unknown): OpenClawJobCompanyHints {
  const r = asRecord(raw);
  if (!r) return {};
  const company = asRecord(r.company) ?? asRecord(r.employer);
  const base = company ?? r;

  const ats = asRecord(r.ats) ?? asRecord(base.ats);

  return {
    companyName:
      safeHintString(
        pickString(base, ["name", "companyName", "employerName", "title"]) ??
          pickNestedString(r, ["company", "name"]) ??
          undefined,
      ),
    domain:
      safeHintString(
        pickString(base, ["domain", "website", "companyDomain", "rootDomain"]) ??
          pickNestedString(r, ["company", "domain"]) ??
          undefined,
      ),
    careersUrl:
      safeCareersUrlHint(
        pickString(base, ["careersUrl", "careersPageUrl", "jobsUrl", "careers"]) ??
          pickString(r, ["careersUrl", "careersPageUrl"]) ??
          undefined,
      ),
    atsType:
      safeHintString(
        pickString(ats ?? {}, ["type", "atsType", "provider"]) ??
          pickString(r, ["atsType", "ats"]) ??
          undefined,
      ),
    atsBoardToken:
      safeHintString(
        pickString(ats ?? {}, ["boardToken", "token", "board", "subdomain"]) ??
          pickString(r, ["atsBoardToken", "boardToken"]) ??
          undefined,
      ),
  };
}

/**
 * Strict mapping for ingestion: invalid rows return a reason (metrics + safe logs).
 */
export function tryMapOpenClawJobToNormalized(
  raw: unknown,
  companyId: string,
  companyDisplayName: string,
): MapOpenClawJobResult {
  const r = asRecord(raw);
  if (!r) {
    return { ok: false, reason: "not_object" };
  }

  const titleRaw =
    pickString(r, ["title", "roleTitle", "jobTitle", "name", "role", "position"]) ??
    pickNestedString(r, ["job", "title"]) ??
    "";
  const urlRaw =
    pickString(r, ["sourceUrl", "url", "jobUrl", "link", "listingUrl", "href"]) ??
    pickNestedString(r, ["links", "job"]) ??
    "";

  if (!titleRaw || !urlRaw) {
    return { ok: false, reason: "missing_title_or_url" };
  }

  if (titleRaw.length > OPENCLAW_MAX_TITLE_LEN || urlRaw.length > OPENCLAW_MAX_URL_INPUT_LEN) {
    return { ok: false, reason: "field_length_exceeded" };
  }

  const title = truncate(titleRaw.trim(), OPENCLAW_MAX_TITLE_LEN).trim();
  if (!title) {
    return { ok: false, reason: "title_empty_after_trim" };
  }

  const listingUrl = coerceOpenClawListingUrl(urlRaw);
  if (!listingUrl) {
    return { ok: false, reason: "invalid_listing_url" };
  }

  const descRaw =
    pickString(r, [
      "description",
      "body",
      "summary",
      "jobDescriptionHtml",
      "jobDescriptionSummary",
      "twoLineJobDescriptionSummary",
    ]) ?? undefined;
  const description =
    sanitizeHtml(descRaw ? truncate(descRaw, OPENCLAW_MAX_DESCRIPTION_LEN) : undefined) ?? undefined;

  const locRaw =
    pickString(r, ["location", "locationsText", "geo", "region"]) ??
    pickNestedString(r, ["location", "name"]) ??
    undefined;
  if (locRaw && locRaw.length > OPENCLAW_MAX_LOCATION_LEN) {
    return { ok: false, reason: "field_length_exceeded" };
  }
  const location =
    trimWhitespace(locRaw ? truncate(locRaw, OPENCLAW_MAX_LOCATION_LEN) : undefined) ?? undefined;

  const postedRaw =
    pickString(r, ["postedAt", "created_at", "createdAt", "publishedAt", "datePosted", "listedAt"]) ??
    undefined;
  const postedAt = safeOpenClawPostedAt(r, postedRaw);

  const applyRaw = pickString(r, ["applyUrl", "applicationUrl", "applicationLink"]) ?? undefined;
  const applyCoerced = coerceOptionalApplyUrl(applyRaw);
  if (!applyCoerced.ok) {
    return { ok: false, reason: "invalid_apply_url" };
  }
  const applyUrl = applyCoerced.url;

  const remoteFlag = r.isRemote;
  const isRemote =
    typeof remoteFlag === "boolean"
      ? remoteFlag
      : inferRemote(`${title} ${location ?? ""} ${description ?? ""}`);

  let atsJobId = pickString(r, ["id", "jobId", "externalId", "uuid", "slug"]) ?? undefined;
  if (atsJobId) {
    if (atsJobId.length > OPENCLAW_MAX_ATS_JOB_ID_LEN) {
      return { ok: false, reason: "field_length_exceeded" };
    }
  }

  const display = truncate(companyDisplayName.trim(), OPENCLAW_MAX_HINT_STRING_LEN);

  return {
    ok: true,
    job: {
      title,
      description,
      location,
      isRemote,
      source: "openclaw",
      sourceUrl: listingUrl,
      applyUrl,
      postedAt,
      companyId,
      companyName: display || undefined,
      atsJobId,
    },
  };
}

/**
 * Backward-compatible wrapper: returns null on any validation failure (no throw).
 */
export function mapOpenClawJobToNormalized(
  raw: unknown,
  companyId: string,
  companyDisplayName: string,
): NormalizedJob | null {
  const r = tryMapOpenClawJobToNormalized(raw, companyId, companyDisplayName);
  if (!r.ok) {
    logger.warn(
      {
        event: "openclaw_mapper_reject",
        provider: "openclaw",
        reason: r.reason,
      },
      "openclaw_mapper_reject",
    );
    return null;
  }
  return r.job;
}
