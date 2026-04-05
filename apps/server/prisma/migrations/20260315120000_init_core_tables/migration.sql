-- Baseline schema required before AtsEndpoint (FK to Company) and additive migrations.
-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('raw', 'enriching', 'ready', 'failed');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "careersUrl" TEXT,
    "atsBoardToken" TEXT,
    "atsType" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'raw',
    "discoverySource" TEXT,
    "enrichmentAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCrawledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "applyUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fingerprint" TEXT,
    "canonicalJobId" TEXT,
    "fingerprintVersion" TEXT,
    "atsJobId" TEXT,
    "freshnessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "role" TEXT NOT NULL DEFAULT 'other',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpBatch" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerpBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpResult" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "atsType" TEXT,
    "slug" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "snippet" TEXT,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discoveredAt" TIMESTAMP(3),

    CONSTRAINT "SerpResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Job_sourceUrl_key" ON "Job"("sourceUrl");

-- CreateIndex
CREATE INDEX "Job_title_idx" ON "Job"("title");

-- CreateIndex
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");

-- CreateIndex
CREATE INDEX "Job_fingerprint_idx" ON "Job"("fingerprint");

-- CreateIndex
CREATE INDEX "Job_canonicalJobId_idx" ON "Job"("canonicalJobId");

-- CreateIndex
CREATE INDEX "Job_freshnessScore_idx" ON "Job"("freshnessScore");

-- CreateIndex
CREATE INDEX "Job_sourceWeight_idx" ON "Job"("sourceWeight");

-- CreateIndex
CREATE INDEX "Job_role_idx" ON "Job"("role");

-- CreateIndex
CREATE INDEX "Job_country_idx" ON "Job"("country");

-- CreateIndex
CREATE INDEX "Job_category_idx" ON "Job"("category");

-- CreateIndex
CREATE INDEX "Job_isRemote_idx" ON "Job"("isRemote");

-- CreateIndex
CREATE INDEX "Job_skills_idx" ON "Job" USING GIN ("skills");

-- CreateIndex
CREATE INDEX "SerpResult_url_idx" ON "SerpResult"("url");

-- CreateIndex
CREATE INDEX "SerpResult_domain_idx" ON "SerpResult"("domain");

-- CreateIndex
CREATE INDEX "SerpResult_atsType_idx" ON "SerpResult"("atsType");

-- CreateIndex
CREATE INDEX "SerpResult_score_idx" ON "SerpResult"("score");

-- CreateIndex
CREATE INDEX "SerpResult_atsType_score_idx" ON "SerpResult"("atsType", "score");

-- CreateIndex
CREATE INDEX "SerpResult_discoveredAt_idx" ON "SerpResult"("discoveredAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_canonicalJobId_fkey" FOREIGN KEY ("canonicalJobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpResult" ADD CONSTRAINT "SerpResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SerpBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
