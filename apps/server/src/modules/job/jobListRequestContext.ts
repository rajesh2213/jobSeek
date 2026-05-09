import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped context for /jobs diagnostics (Prisma query correlation, slow-path logs).
 * Populated only around `runMeteredJobsList` in the listing handler.
 */
export type JobListRequestDiagContext = {
  sort: "latest" | "salary_desc";
  page: number;
  limit: number;
  meteredLimit: number;
  /** Safe summary only — no raw user strings. */
  filterSummary: Record<string, unknown>;
};

export const jobListRequestDiag = new AsyncLocalStorage<JobListRequestDiagContext>();
