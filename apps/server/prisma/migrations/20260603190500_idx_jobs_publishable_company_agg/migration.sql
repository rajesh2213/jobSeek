-- Partial index for company listing aggregation (GROUP BY companyId on publishable jobs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_publishable_company_agg
  ON "Job" ("companyId")
  WHERE "canonicalJobId" IS NULL
    AND "isActive" = true
    AND ("status" = 'ready' OR "status" IS NULL)
    AND "isPublishable" = true;
