/**
 * QUERY_GUARD:
 * Heavy-table Prisma reads (`job`, `serpResult`, `atsEndpoint`, `company`) must include explicit `select`.
 * Avoid `findMany({ where: ... })` without `select` to reduce row egress and CPU.
 */
export const HEAVY_TABLE_SELECT_GUARD = [
  "job",
  "serpResult",
  "atsEndpoint",
  "company",
] as const;

