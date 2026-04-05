-- Align AtsEndpoint with current Prisma schema (columns missing from original migration).
ALTER TABLE "AtsEndpoint" ADD COLUMN IF NOT EXISTS "lastCrawledAt" TIMESTAMP(3);
ALTER TABLE "AtsEndpoint" ADD COLUMN IF NOT EXISTS "successCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AtsEndpoint" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "AtsEndpoint" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "AtsEndpoint" ADD COLUMN IF NOT EXISTS "score" INTEGER NOT NULL DEFAULT 0;
