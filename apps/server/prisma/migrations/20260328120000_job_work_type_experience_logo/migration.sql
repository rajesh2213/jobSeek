-- Additive columns; existing rows get workType from isRemote.

ALTER TABLE "Company" ADD COLUMN "logoUrl" TEXT;

ALTER TABLE "Job" ADD COLUMN "workType" TEXT NOT NULL DEFAULT 'onsite';
ALTER TABLE "Job" ADD COLUMN "experienceLevel" TEXT;

UPDATE "Job" SET "workType" = 'remote' WHERE "isRemote" = true;

CREATE INDEX "Job_workType_idx" ON "Job"("workType");
CREATE INDEX "Job_experienceLevel_idx" ON "Job"("experienceLevel");
