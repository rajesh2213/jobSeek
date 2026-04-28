-- CreateEnum
CREATE TYPE "EmailFrequency" AS ENUM ('daily', 'weekly', 'off');

-- CreateEnum
CREATE TYPE "GrowthEmailCampaignType" AS ENUM (
  'daily_digest',
  'weekly_digest',
  'reengagement',
  'personalized',
  'event_welcome',
  'event_followup',
  'event_saved_search_suggestions'
);

-- CreateEnum
CREATE TYPE "GrowthEmailSendStatus" AS ENUM ('sent', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "EmailJobSendChannel" AS ENUM ('saved_search_alert', 'growth_email');

-- CreateTable
CREATE TABLE "EmailPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "marketingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "frequency" "EmailFrequency" NOT NULL DEFAULT 'daily',
  "source" TEXT DEFAULT 'signup_default',
  "lastActiveAt" TIMESTAMP(3),
  "lastGrowthEmailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLead" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthEmailSend" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "campaignType" "GrowthEmailCampaignType" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "status" "GrowthEmailSendStatus" NOT NULL DEFAULT 'sent',
  "providerMessageId" TEXT,
  "subjectUsed" TEXT,
  "jobCountSent" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GrowthEmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJobSendLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "channel" "EmailJobSendChannel" NOT NULL,
  "growthSendId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailJobSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailPreference_userId_key" ON "EmailPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLead_email_key" ON "EmailLead"("email");

-- CreateIndex
CREATE INDEX "EmailPreference_marketingEnabled_frequency_idx" ON "EmailPreference"("marketingEnabled", "frequency");

-- CreateIndex
CREATE INDEX "EmailPreference_lastGrowthEmailSentAt_idx" ON "EmailPreference"("lastGrowthEmailSentAt");

-- CreateIndex
CREATE INDEX "EmailPreference_lastActiveAt_idx" ON "EmailPreference"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthEmailSend_userId_campaignType_periodKey_key" ON "GrowthEmailSend"("userId", "campaignType", "periodKey");

-- CreateIndex
CREATE INDEX "GrowthEmailSend_userId_createdAt_idx" ON "GrowthEmailSend"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailJobSendLog_userId_sentAt_idx" ON "EmailJobSendLog"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailJobSendLog_userId_jobId_sentAt_idx" ON "EmailJobSendLog"("userId", "jobId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailJobSendLog_growthSendId_idx" ON "EmailJobSendLog"("growthSendId");

-- AddForeignKey
ALTER TABLE "EmailPreference" ADD CONSTRAINT "EmailPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthEmailSend" ADD CONSTRAINT "GrowthEmailSend_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJobSendLog" ADD CONSTRAINT "EmailJobSendLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJobSendLog" ADD CONSTRAINT "EmailJobSendLog_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJobSendLog" ADD CONSTRAINT "EmailJobSendLog_growthSendId_fkey"
  FOREIGN KEY ("growthSendId") REFERENCES "GrowthEmailSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
