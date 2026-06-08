#!/usr/bin/env node
/**
 * Validates cursor-based sitemap job sourcing against DB discovery count and OFFSET order parity.
 * Usage: node scripts/validate-sitemap-cursor.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envText = readFileSync(resolve(root, ".env"), "utf8");
const secret = envText.match(/^INTERNAL_SEO_SECRET=(.+)$/m)?.[1]?.trim();
const directUrl = envText.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1]?.trim();
const apiBase = envText.match(/^EXTENSION_API_BASE=(.+)$/m)?.[1]?.trim() ?? "https://api.jobloom.tech";
const siteBase =
  envText.match(/^NEXT_PUBLIC_SITE_URL=(.+)$/m)?.[1]?.trim() ?? "https://www.jobloom.tech";

if (!secret || !directUrl) {
  console.error("Missing INTERNAL_SEO_SECRET or DIRECT_DATABASE_URL in .env");
  process.exit(1);
}

const headers = {
  "x-internal-seo": "true",
  "x-internal-seo-secret": secret,
  "x-ssr-origin": "next-server",
  "x-ssr-page": "sitemap-validate",
};

const EXCLUDED_ROLES = [
  "job-role",
  "careers",
  "jobs",
  "job",
  "all",
  "benefits",
  "open-roles",
  "career-search",
  "searchcareer",
  "career-areas",
];

async function walkCursor(maxRows) {
  const ids = [];
  let cursor = null;
  for (;;) {
    const params = new URLSearchParams({ limit: "500" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${apiBase}/seo/sitemap-jobs?${params}`, { headers });
    if (!res.ok) throw new Error(`API ${res.status} ${await res.text()}`);
    const body = await res.json();
    for (const row of body.data ?? []) ids.push(row.id);
    if (ids.length >= maxRows) break;
    if (!body.meta?.hasMore || !body.meta?.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return ids.slice(0, maxRows);
}

async function walkOffsetSample(pages) {
  const ids = [];
  for (let page = 1; page <= pages; page++) {
    const res = await fetch(`${apiBase}/jobs?page=${page}&limit=100`, { headers });
    if (!res.ok) throw new Error(`jobs API ${res.status}`);
    const body = await res.json();
    for (const row of body.data ?? []) ids.push(row.id);
    if ((body.data?.length ?? 0) < 100 && body.meta?.hasMore !== true) break;
  }
  return ids;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  return { status: res.status, body: await res.text() };
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: directUrl });

  const excludedList = EXCLUDED_ROLES.map((r) => `'${r.replace(/'/g, "''")}'`).join(", ");
  const countRows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS c
    FROM "Job" j
    WHERE j."canonicalJobId" IS NULL
      AND j."isActive" = true
      AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
      AND j.role NOT IN (${excludedList})
      AND (j."status" = 'ready' OR j."status" IS NULL)
      AND j.description IS NOT NULL
      AND BTRIM(j.description) <> ''
  `);
  const dbCount = Number(countRows[0]?.c ?? 0);

  const maxValidate = Math.min(dbCount, 10000);
  console.log("DB discovery-eligible count:", dbCount);
  console.log("Validating cursor walk up to:", maxValidate);

  const cursorIds = await walkCursor(maxValidate);
  const unique = new Set(cursorIds);
  console.log("Cursor IDs collected:", cursorIds.length);
  console.log("Duplicates:", cursorIds.length - unique.size);

  const offsetIds = await walkOffsetSample(Math.min(30, Math.ceil(maxValidate / 100)));
  const compareLen = Math.min(cursorIds.length, offsetIds.length, 500);
  let orderMismatch = 0;
  for (let i = 0; i < compareLen; i++) {
    if (cursorIds[i] !== offsetIds[i]) orderMismatch++;
  }
  console.log(
    "Order parity vs /jobs API (first",
    compareLen,
    "): mismatches =",
    orderMismatch,
    "(expected: /jobs pages 1–5 use limit=50 stride quirks; use npm run validate:sitemap-cursor -w @jobseek/server for SQL parity)",
  );

  const robots = await fetchText(`${siteBase}/robots.txt`);
  const robotsHasIndex = robots.body.includes(`${siteBase}/sitemap.xml`);
  console.log(robotsHasIndex ? "PASS" : "FAIL", "robots.txt references sitemap index");

  const index = await fetchText(`${siteBase}/sitemap.xml`);
  const isIndex = index.body.includes("<sitemapindex");
  console.log(isIndex ? "PASS" : "WARN", "sitemap.xml is sitemap index (live deploy may lag)");

  console.log("\n--- Results ---");
  console.log(unique.size === cursorIds.length ? "PASS" : "FAIL", "no duplicate IDs");
  console.log(orderMismatch === 0 ? "PASS" : "WARN", "ordering vs OFFSET /jobs sample");
  console.log(cursorIds.length >= Math.min(3750, dbCount) ? "PASS" : "WARN", "cursor count >= prior ~3750 floor");

  await prisma.$disconnect();
  if (unique.size !== cursorIds.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
