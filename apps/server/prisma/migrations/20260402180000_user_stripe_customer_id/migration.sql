-- Stripe Customer id on User (create-checkout persists after first session)
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
