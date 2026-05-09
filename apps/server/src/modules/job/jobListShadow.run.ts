import type { PrismaClient } from "@prisma/client";
import {
  createJobRepository,
  sqlForCanonicalListingIds,
  type JobDiscoveryFilters,
  type JobWithCompany,
} from "./job.repository.js";
import { toJobListJson, type JobWithCompanyRow } from "./job.mapper.js";
import { diffJobListJsonArrays } from "./jobListShadow.util.js";
import { nowPerfMs } from "../../utils/jobListPerf.js";

export type JobListShadowInput = {
  filters?: JobDiscoveryFilters;
  sort: "latest" | "salary_desc";
  limit: number;
  offset: number;
  includeProcessing?: boolean;
  /** Raw request value; clamped to 256..500_000 for SQL LEFT(description, n). */
  truncChars: number;
};

export type JobListShadowResult = {
  ok: boolean;
  queryIdsMs: number;
  rowCount: number;
  limit: number;
  offset: number;
  sort: "latest" | "salary_desc";
  truncCharsUsed?: number;
  variants: Record<string, unknown>;
};

function serializeJobList(rows: JobWithCompany[]): Record<string, unknown>[] {
  return rows.map((j) => toJobListJson(j as unknown as JobWithCompanyRow));
}

/**
 * Same work as GET /internal/job-list/hydrate-shadow (for CLI probes and the HTTP route).
 * Does not perform auth; callers must restrict access.
 */
export async function runJobListHydrateShadow(
  prisma: PrismaClient,
  input: JobListShadowInput,
): Promise<JobListShadowResult> {
  const sort = input.sort ?? "latest";
  const limit = input.limit;
  const offset = input.offset;
  const includeProcessing = input.includeProcessing ?? false;
  const truncCharsUsed = Math.max(
    256,
    Math.min(500_000, Math.floor(input.truncChars)),
  );

  const repo = createJobRepository(prisma);
  const idQuery = sqlForCanonicalListingIds({
    filters: input.filters,
    sort,
    limit,
    offset,
    includeProcessing,
  });

  const tId0 = nowPerfMs();
  const idRows = await prisma.$queryRaw<{ id: string }[]>(idQuery);
  const queryIdsMs = Math.round((nowPerfMs() - tId0) * 100) / 100;
  const ids = idRows.map((r) => r.id);

  if (ids.length === 0) {
    return {
      ok: true,
      queryIdsMs,
      rowCount: 0,
      limit,
      offset,
      sort,
      variants: {},
    };
  }

  const tB0 = nowPerfMs();
  const baseline = await repo.hydrateCanonicalListingForShadow(ids, true);
  const baselineMs = nowPerfMs() - tB0;
  const baselineJson = serializeJobList(baseline);
  const baselineBytes = Buffer.byteLength(JSON.stringify(baseline), "utf8");

  const tO0 = nowPerfMs();
  const omitCountRows = await repo.hydrateCanonicalListingForShadow(ids, false);
  const omitCountMs = nowPerfMs() - tO0;
  const omitCountBytes = Buffer.byteLength(JSON.stringify(omitCountRows), "utf8");

  const baselineById = new Map(baseline.map((j) => [j.id, j]));
  const omitPatched = omitCountRows.map((row) => {
    const base = baselineById.get(row.id);
    const count = base?.company._count;
    return {
      ...row,
      company: { ...row.company, ...(count ? { _count: count } : {}) },
    } as JobWithCompany;
  });
  const omitPatchedJson = serializeJobList(omitPatched);
  const diffOmitVsBaseline = diffJobListJsonArrays(baselineJson, omitPatchedJson);

  const tT0 = nowPerfMs();
  const truncRows = await repo.hydrateCanonicalListingTruncDescriptionForShadow(
    ids,
    truncCharsUsed,
    true,
  );
  const truncMs = nowPerfMs() - tT0;
  const truncBytes = Buffer.byteLength(JSON.stringify(truncRows), "utf8");
  const truncJson = serializeJobList(truncRows);
  const diffTruncVsBaseline = diffJobListJsonArrays(baselineJson, truncJson);

  return {
    ok: true,
    queryIdsMs,
    rowCount: ids.length,
    limit,
    offset,
    sort,
    truncCharsUsed,
    variants: {
      baseline: {
        hydrateMs: Math.round(baselineMs * 100) / 100,
        approxPrismaBytes: baselineBytes,
        approxApiJsonBytes: Buffer.byteLength(JSON.stringify(baselineJson), "utf8"),
      },
      omitCompanyJobCount: {
        hydrateMs: Math.round(omitCountMs * 100) / 100,
        approxPrismaBytes: omitCountBytes,
        hydrateMsDeltaVsBaseline: Math.round((omitCountMs - baselineMs) * 100) / 100,
        jsonVsBaselineWhenPatchedWithBaselineCounts: diffOmitVsBaseline,
      },
      truncDescriptionSql: {
        hydrateMs: Math.round(truncMs * 100) / 100,
        approxPrismaBytes: truncBytes,
        hydrateMsDeltaVsBaseline: Math.round((truncMs - baselineMs) * 100) / 100,
        jsonVsBaseline: diffTruncVsBaseline,
      },
    },
  };
}
