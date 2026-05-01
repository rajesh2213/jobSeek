import type { FastifyRequest } from "fastify";

/**
 * Detect Next/router-style prefetch so expensive side effects (e.g. daily job-view caps)
 * do not run until the user actually navigates.
 */
export function isLikelyPrefetchRequest(request: FastifyRequest): boolean {
  const h = request.headers;
  const raw = (v: string | string[] | undefined): string => {
    if (typeof v === "string") return v.trim().toLowerCase();
    if (Array.isArray(v) && v.length > 0) return String(v[0]).trim().toLowerCase();
    return "";
  };
  if (raw(h["next-router-prefetch"]) === "1") return true;
  if (raw(h["next-router-segment-prefetch"]) !== "") return true;
  if (raw(h["purpose"]) === "prefetch") return true;
  if (raw(h["sec-purpose"]) === "prefetch") return true;
  return false;
}
