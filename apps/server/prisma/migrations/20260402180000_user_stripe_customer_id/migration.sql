-- Stripe Customer id on User (create-checkout persists after first session)
-- Guarded because this migration timestamp predates User table creation
-- in this repository's migration history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'User'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
  END IF;
END $$;
