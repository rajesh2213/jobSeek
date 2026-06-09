-- Backfill nullable quality flags so discovery can use indexed j."isPublishable" = true.
UPDATE "Job" j
SET
  "hasNonemptyDescription" = (j.description IS NOT NULL AND BTRIM(j.description) <> ''),
  "hasUsableParsed" = (
    j."parsedDescription" IS NULL
    OR (
      jsonb_typeof(j."parsedDescription") = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each(j."parsedDescription") AS e(key, val)
        WHERE jsonb_typeof(val) = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(val) AS line
            WHERE BTRIM(line) <> ''
          )
      )
    )
  ),
  "hasValidWorkdayUrlShape" = (
    j.source <> 'workday'
    OR NOT (LOWER(BTRIM(j."sourceUrl")) LIKE '%myworkdayjobs.com/job/%')
  )
WHERE j."isPublishable" IS NULL;

UPDATE "Job"
SET
  "isPublishable" = (
    COALESCE("hasNonemptyDescription", false)
    AND COALESCE("hasUsableParsed", false)
    AND COALESCE("hasValidWorkdayUrlShape", false)
  ),
  "requiresRepair" = NOT (
    COALESCE("hasNonemptyDescription", false)
    AND COALESCE("hasUsableParsed", false)
    AND COALESCE("hasValidWorkdayUrlShape", false)
  )
WHERE "isPublishable" IS NULL;
