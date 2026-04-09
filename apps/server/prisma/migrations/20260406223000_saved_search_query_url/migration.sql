ALTER TABLE "SavedSearch" ADD COLUMN "query" TEXT NOT NULL DEFAULT '/jobs';
ALTER TABLE "SavedSearch" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SavedSearch" ALTER COLUMN "name" DROP NOT NULL;

ALTER TABLE "SavedSearch" DROP COLUMN IF EXISTS "filters";
ALTER TABLE "SavedSearch" DROP COLUMN IF EXISTS "lastAlertAt";

CREATE UNIQUE INDEX "SavedSearch_userId_query_key" ON "SavedSearch"("userId", "query");
