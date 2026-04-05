-- Hierarchical location columns; keep legacy `country` until callers migrate.
ALTER TABLE "Job" ADD COLUMN "locationCity" TEXT;
ALTER TABLE "Job" ADD COLUMN "locationState" TEXT;
ALTER TABLE "Job" ADD COLUMN "locationCountry" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Job" ADD COLUMN "locationRegion" TEXT;

UPDATE "Job" SET "locationCountry" = "country";

CREATE INDEX "Job_locationCountry_idx" ON "Job"("locationCountry");
CREATE INDEX "Job_locationRegion_idx" ON "Job"("locationRegion");
