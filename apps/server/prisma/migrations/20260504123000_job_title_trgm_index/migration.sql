-- Supports ILIKE '%term%' discovery filters on Job.title via trigram ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Job_title_trgm_idx" ON "Job" USING gin (title gin_trgm_ops);
