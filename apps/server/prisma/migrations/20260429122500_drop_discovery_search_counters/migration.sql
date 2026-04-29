-- Drop legacy discovery-search counters; list metering now uses jobViewsToday only.
ALTER TABLE "User"
DROP COLUMN IF EXISTS "discoverySearchesToday",
DROP COLUMN IF EXISTS "discoveryBonusFiveUsed";
