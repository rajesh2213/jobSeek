-- Rule-based structured metadata derived from parsedDescription (see modules/enrichment).
ALTER TABLE "Job" ADD COLUMN "enriched" JSONB;
