-- CreateEnum
CREATE TYPE "CompanyCrawlPriority" AS ENUM ('high', 'medium', 'low');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "priority" "CompanyCrawlPriority" NOT NULL DEFAULT 'low';
ALTER TABLE "Company" ADD COLUMN "lastIngestionSuccessAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "ingestionAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "canonicalJobsLast7d" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Company_priority_score_idx" ON "Company"("priority", "score");
CREATE INDEX "Company_lastAttemptAt_idx" ON "Company"("lastAttemptAt");
