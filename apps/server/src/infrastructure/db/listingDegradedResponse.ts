import type { FastifyReply } from "fastify";
import { isDbPoolExhaustedError } from "./isDbPoolExhausted.js";

export function isListingDegradedDbError(err: unknown): boolean {
  if (isDbPoolExhaustedError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes(":closed") || msg.includes("FATAL: Internal error")) return true;
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code ?? "")
      : "";
  if (code === "P2010") {
    const meta =
      err && typeof err === "object" && "meta" in err
        ? (err as { meta?: { code?: string } }).meta
        : undefined;
    return meta?.code === "57014";
  }
  return msg.includes("statement timeout") || msg.includes("57014");
}

export function sendJobsListingDegraded(
  reply: FastifyReply,
  input: { page: number; pageSize: number },
): ReturnType<FastifyReply["status"]> {
  return reply.status(503).send({
    data: [],
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total: null,
      hasMore: false,
      viewCapUnlimited: false,
    },
    error: "Service temporarily busy",
    code: "DB_POOL_EXHAUSTED",
  });
}

export function sendCompaniesListingDegraded(
  reply: FastifyReply,
  input: { page: number; limit: number },
): ReturnType<FastifyReply["status"]> {
  return reply.status(503).send({
    data: [],
    meta: {
      page: input.page,
      limit: input.limit,
      total: 0,
      totalPages: 1,
      hasMore: false,
      stats: { totalTracked: 0, hiringThisWeek: 0 },
    },
    error: "Service temporarily busy",
    code: "DB_POOL_EXHAUSTED",
  });
}
