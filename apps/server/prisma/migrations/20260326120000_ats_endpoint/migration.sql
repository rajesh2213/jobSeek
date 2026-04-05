-- CreateTable
CREATE TABLE "AtsEndpoint" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "companyName" TEXT,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtsEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtsEndpoint_type_slug_key" ON "AtsEndpoint"("type", "slug");

-- CreateIndex
CREATE INDEX "AtsEndpoint_companyId_idx" ON "AtsEndpoint"("companyId");

-- CreateIndex
CREATE INDEX "AtsEndpoint_type_isActive_idx" ON "AtsEndpoint"("type", "isActive");

-- AddForeignKey
ALTER TABLE "AtsEndpoint" ADD CONSTRAINT "AtsEndpoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
