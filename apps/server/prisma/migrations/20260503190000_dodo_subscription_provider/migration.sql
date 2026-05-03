-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('paypal', 'dodo');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "dodoSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_dodoSubscriptionId_key" ON "Subscription"("dodoSubscriptionId");

-- Migrate provider text to enum
ALTER TABLE "Subscription" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "Subscription"
  ALTER COLUMN "provider" TYPE "SubscriptionProvider"
  USING (CASE
    WHEN "provider" = 'paypal' THEN 'paypal'::"SubscriptionProvider"
    WHEN "provider" = 'dodo' THEN 'dodo'::"SubscriptionProvider"
    ELSE 'paypal'::"SubscriptionProvider"
  END);
ALTER TABLE "Subscription" ALTER COLUMN "provider" SET DEFAULT 'paypal';
