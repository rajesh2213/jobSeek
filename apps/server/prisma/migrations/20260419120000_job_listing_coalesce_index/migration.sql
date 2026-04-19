-- Partial expression index for discovery listing: ORDER BY COALESCE("postedAt", "createdAt") DESC
-- with canonicalJobId IS NULL (see findManyCanonicalFiltered raw ID query in job.repository.ts).
--
-- Large production tables: consider creating the same definition with CREATE INDEX CONCURRENTLY
-- outside a transaction during a maintenance window; Prisma migrate runs in a transaction and
-- cannot use CONCURRENTLY in PostgreSQL.

CREATE INDEX IF NOT EXISTS "Job_listing_sort_coalesce_idx"
ON "Job" ((COALESCE("postedAt", "createdAt")) DESC NULLS LAST)
WHERE "canonicalJobId" IS NULL;
