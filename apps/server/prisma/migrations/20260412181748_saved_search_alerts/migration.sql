-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN     "alertEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "alertJobsSeen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "alertLastSentAt" TIMESTAMP(3),
ADD COLUMN     "alertThreshold" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "SavedSearch_alertEnabled_idx" ON "SavedSearch"("alertEnabled");
