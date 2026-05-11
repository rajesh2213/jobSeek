-- Additive nullable quality flags (no defaults) to avoid table rewrite risk.
ALTER TABLE "Job"
  ADD COLUMN "hasNonemptyDescription" BOOLEAN,
  ADD COLUMN "hasUsableParsed" BOOLEAN,
  ADD COLUMN "hasValidWorkdayUrlShape" BOOLEAN,
  ADD COLUMN "isPublishable" BOOLEAN,
  ADD COLUMN "requiresRepair" BOOLEAN;

ALTER TABLE "Company"
  ADD COLUMN "isPlaceholderCompany" BOOLEAN,
  ADD COLUMN "isCompanyVerified" BOOLEAN,
  ADD COLUMN "requiresCompanyRepair" BOOLEAN;
