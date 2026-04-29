-- Migrate Subscription to provider-based billing with PayPal primary.
ALTER TABLE "Subscription"
ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'paypal',
ADD COLUMN IF NOT EXISTS "paypalId" TEXT;

ALTER TABLE "Subscription"
ALTER COLUMN "stripeCustomerId" DROP NOT NULL,
ALTER COLUMN "stripePriceId" DROP NOT NULL,
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_paypalId_key" ON "Subscription"("paypalId");
