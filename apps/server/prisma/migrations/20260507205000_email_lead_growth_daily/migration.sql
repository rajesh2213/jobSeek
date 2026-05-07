-- Track popup-captured email leads for daily growth sends.
ALTER TABLE "EmailLead"
ADD COLUMN "marketingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "frequency" "EmailFrequency" NOT NULL DEFAULT 'daily',
ADD COLUMN "lastGrowthEmailSentAt" TIMESTAMP(3),
ADD COLUMN "unsubscribedAt" TIMESTAMP(3);

CREATE INDEX "EmailLead_marketingEnabled_frequency_idx" ON "EmailLead"("marketingEnabled", "frequency");
CREATE INDEX "EmailLead_lastGrowthEmailSentAt_idx" ON "EmailLead"("lastGrowthEmailSentAt");

CREATE TABLE "EmailLeadGrowthSend" (
  "id" TEXT NOT NULL,
  "emailLeadId" TEXT NOT NULL,
  "campaignType" "GrowthEmailCampaignType" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "status" "GrowthEmailSendStatus" NOT NULL DEFAULT 'sent',
  "providerMessageId" TEXT,
  "subjectUsed" TEXT,
  "jobCountSent" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailLeadGrowthSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailLeadGrowthSend_emailLeadId_campaignType_periodKey_key"
ON "EmailLeadGrowthSend"("emailLeadId", "campaignType", "periodKey");

CREATE INDEX "EmailLeadGrowthSend_emailLeadId_createdAt_idx"
ON "EmailLeadGrowthSend"("emailLeadId", "createdAt");

ALTER TABLE "EmailLeadGrowthSend"
ADD CONSTRAINT "EmailLeadGrowthSend_emailLeadId_fkey"
FOREIGN KEY ("emailLeadId") REFERENCES "EmailLead"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
