ALTER TABLE "Subscription"
ADD COLUMN IF NOT EXISTS "graceEndsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProcessedWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedWebhookEvent_eventId_key" ON "ProcessedWebhookEvent"("eventId");
