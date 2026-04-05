-- ingestion validation (temporary; delete after use)
SELECT id, type, slug, "isActive", score, "successCount", "failureCount", source, LEFT("baseUrl", 80) AS base_preview
FROM "AtsEndpoint" ORDER BY "createdAt" DESC LIMIT 5;

SELECT COUNT(*) AS job_count FROM "Job";

SELECT id, url, domain, "atsType", slug, score, "discoveredAt"
FROM "SerpResult" WHERE "discoveredAt" IS NOT NULL LIMIT 10;

SELECT id, type, slug, "isActive", score, "successCount", source, LEFT("baseUrl", 100) AS base_preview, "createdAt"
FROM "AtsEndpoint" ORDER BY "createdAt" DESC LIMIT 10;
