-- Partial index for activeHiringCompanies stats query (COUNT DISTINCT companyId).
-- Production rollout: CREATE INDEX CONCURRENTLY (cannot run inside Prisma migrate transaction).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active_hiring_company
  ON "Job" ("companyId")
  WHERE "canonicalJobId" IS NULL
    AND status = 'ready'
    AND "isActive" = true
    AND description IS NOT NULL
    AND description <> '';
