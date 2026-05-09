import type { Prisma, PrismaClient } from "../prisma/generatedClient.js";
import { logger } from "./logger.js";
import { createHash } from "node:crypto";
import { jobListRequestDiag } from "../modules/job/jobListRequestContext.js";

/**
 * When `PRISMA_QUERY_DIAG=1`, Prisma emits query events (see `infrastructure/db/prisma.ts`).
 * Logs are rate-limited and params are redacted. OFF by default.
 */

export function isPrismaQueryDiagEnabled(): boolean {
  return process.env.PRISMA_QUERY_DIAG?.trim() === "1";
}

function maxLogsPerMinute(): number {
  const raw = process.env.PRISMA_QUERY_DIAG_MAX_PER_MIN?.trim();
  const n = raw ? Number(raw) : 40;
  return Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : 40;
}

let windowStart = Date.now();
let logsInWindow = 0;

function allowLog(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    logsInWindow = 0;
  }
  const max = maxLogsPerMinute();
  if (logsInWindow >= max) return false;
  logsInWindow++;
  return true;
}

/** Redact bind values from Prisma `params` JSON array string. */
export function redactPrismaParams(params: string): string {
  try {
    const arr = JSON.parse(params) as unknown;
    if (!Array.isArray(arr)) return "[non-array]";
    const out = arr.map((v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v === "string") {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
          return "<uuid>";
        }
        if (v.length > 48) return `<str:${v.length}>`;
        return v;
      }
      if (typeof v === "object") return "<object>";
      return String(v);
    });
    return JSON.stringify(out);
  } catch {
    return "[unparsed-params]";
  }
}

function sqlFingerprint(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

const MAX_SQL_PREVIEW = 900;

export function registerPrismaQueryDiagnostics(prisma: PrismaClient): void {
  /** Runtime enables query events via `log`; generated `$on` typings may still be `never`. */
  const emitter = prisma as unknown as {
    $on(event: "query", callback: (e: Prisma.QueryEvent) => void): void;
  };
  emitter.$on("query", (e: Prisma.QueryEvent) => {
    if (!allowLog()) return;

    const queryPreview =
      e.query.length > MAX_SQL_PREVIEW ? `${e.query.slice(0, MAX_SQL_PREVIEW)}…` : e.query;
    const jobCtx = jobListRequestDiag.getStore();

    logger.info(
      {
        event: "prisma_query_diag",
        durationMs: e.duration,
        sqlSha256_16: sqlFingerprint(e.query),
        sqlChars: e.query.length,
        sqlPreview: queryPreview.replace(/\s+/g, " ").trim(),
        paramsRedacted: redactPrismaParams(e.params),
        target: e.target,
        jobListDiag: jobCtx
          ? {
              sort: jobCtx.sort,
              page: jobCtx.page,
              limit: jobCtx.limit,
              meteredLimit: jobCtx.meteredLimit,
            }
          : undefined,
      },
      "prisma_query_diag",
    );
  });
}

