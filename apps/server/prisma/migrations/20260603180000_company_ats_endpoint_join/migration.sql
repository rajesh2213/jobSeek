-- M:N join for companies sharing one ATS board (Class A collisions, acquisitions).
CREATE TABLE "CompanyAtsEndpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'link',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAtsEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyAtsEndpoint_companyId_endpointId_key"
  ON "CompanyAtsEndpoint"("companyId", "endpointId");

CREATE INDEX "CompanyAtsEndpoint_companyId_idx"
  ON "CompanyAtsEndpoint"("companyId");

CREATE INDEX "CompanyAtsEndpoint_endpointId_idx"
  ON "CompanyAtsEndpoint"("endpointId");

ALTER TABLE "CompanyAtsEndpoint"
  ADD CONSTRAINT "CompanyAtsEndpoint_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyAtsEndpoint"
  ADD CONSTRAINT "CompanyAtsEndpoint_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "AtsEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing primary owner links (idempotent).
INSERT INTO "CompanyAtsEndpoint" ("id", "companyId", "endpointId", "source", "createdAt")
SELECT
  gen_random_uuid()::text,
  e."companyId",
  e."id",
  'backfill_primary',
  NOW()
FROM "AtsEndpoint" e
WHERE e."companyId" IS NOT NULL
ON CONFLICT ("companyId", "endpointId") DO NOTHING;
