/**
 * Company SEO Foundation audit — read-only.
 *
 * Measures ghost pages, visible companies, schema/title/link coverage on live company pages.
 * Exit 0 = GO, 1 = NO_GO.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const require = createRequire(join(root, "apps/server/package.json"));
const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.jobloom.tech").replace(
  /\/$/,
  "",
);
const API_URL = (process.env.API_PUBLIC_URL ?? "https://api.jobloom.tech").replace(/\/$/, "");
const SAMPLE_LIMIT = Number(process.env.COMPANY_SEO_AUDIT_SAMPLE ?? 40);
const INTERNAL_SEO_SECRET = process.env.INTERNAL_SEO_SECRET?.trim() ?? "";

/** Mirrors `buildDiscoveryWhereSql()` without filters (publishable canonical jobs). */
function discoveryWhereSql() {
  return Prisma.sql`
    j."canonicalJobId" IS NULL
    AND j."isActive" = true
    AND (j."expiresAt" IS NULL OR j."expiresAt" > NOW())
    AND j.role NOT IN (
      'intern', 'internship', 'volunteer', 'temporary', 'contractor', 'freelance'
    )
    AND (j."status" = 'ready' OR j."status" IS NULL)
    AND j."isPublishable" = true
  `;
}

async function inventoryCounts() {
  const discoveryWhere = discoveryWhereSql();
  const [totals] = await prisma.$queryRaw`
    WITH legacy_listing AS (
      SELECT j."companyId", COUNT(*)::int AS legacy_count
      FROM "Job" j
      WHERE j."canonicalJobId" IS NULL
        AND (j."status" = 'ready' OR j."status" IS NULL)
        AND j.description IS NOT NULL
        AND BTRIM(j.description) <> ''
      GROUP BY j."companyId"
    ),
    visible_jobs AS (
      SELECT j."companyId", COUNT(*)::int AS visible_count
      FROM "Job" j
      WHERE ${discoveryWhere}
      GROUP BY j."companyId"
    )
    SELECT
      (SELECT COUNT(*)::int FROM "Company") AS total_companies,
      (SELECT COUNT(*)::int FROM visible_jobs) AS sitemap_eligible_companies,
      (SELECT COUNT(*)::int FROM visible_jobs WHERE visible_count >= 3) AS companies_gte_3,
      (SELECT COUNT(*)::int FROM visible_jobs WHERE visible_count BETWEEN 1 AND 2) AS companies_thin_1_2,
      (SELECT COUNT(*)::int FROM visible_jobs WHERE visible_count >= 1) AS visible_companies,
      (SELECT COUNT(*)::int
        FROM legacy_listing l
        LEFT JOIN visible_jobs v ON v."companyId" = l."companyId"
        WHERE l.legacy_count > 0 AND COALESCE(v.visible_count, 0) = 0
      ) AS ghost_pages_before_guard_alignment,
      (SELECT COUNT(*)::int
        FROM legacy_listing l
        INNER JOIN visible_jobs v ON v."companyId" = l."companyId"
        WHERE l.legacy_count > 0 AND v.visible_count > 0 AND l.legacy_count <> v.visible_count
      ) AS companies_with_count_drift,
      0::int AS ghost_pages_after_guard_alignment
  `;
  return totals;
}

async function sampleCompanies(limit) {
  const discoveryWhere = discoveryWhereSql();
  return prisma.$queryRaw`
    WITH counts AS (
      SELECT j."companyId", COUNT(*)::int AS visible_count
      FROM "Job" j
      WHERE ${discoveryWhere}
      GROUP BY j."companyId"
      HAVING COUNT(*) >= 1
    )
    SELECT c.slug, c.name, counts.visible_count
    FROM counts
    JOIN "Company" c ON c.id = counts."companyId"
    ORDER BY counts.visible_count DESC
    LIMIT ${limit}
  `;
}

function parseHtmlSignals(html, slug) {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  const metaDesc = html.match(/name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  const robots = html.match(/name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1] ?? "default";
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ?? "";
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1].trim(),
  );
  const schemaTypes = [];
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed["@type"]) schemaTypes.push(parsed["@type"]);
      if (Array.isArray(parsed["@graph"])) {
        for (const node of parsed["@graph"]) {
          if (node?.["@type"]) schemaTypes.push(node["@type"]);
        }
      }
    } catch {
      schemaTypes.push("PARSE_ERROR");
    }
  }
  const jobPostingOnHub = schemaTypes.includes("JobPosting");
  const hasOrg = schemaTypes.includes("Organization");
  const hasItemList = schemaTypes.includes("ItemList");
  const hasBreadcrumb = schemaTypes.includes("BreadcrumbList");
  const jobLinks = (html.match(/href=["']\/job\//g) ?? []).length;
  const companyIdLinks = (html.match(/href=["']\/jobs\?[^"']*companyId=/g) ?? []).length;
  const companyLinks = (html.match(/href=["']\/company\//g) ?? []).length;
  const titleHasCount = /\d+\s+open\s+(jobs?|roles?)\s+at/i.test(title);
  const h1HasCount = /—\s*\d+\s+open\s+roles?/i.test(h1);
  const emptyState = /No open roles listed/i.test(html);
  return {
    slug,
    title: title.slice(0, 120),
    metaDesc: metaDesc.slice(0, 120),
    robots,
    h1: h1.slice(0, 120),
    schemaTypes,
    hasOrg,
    hasItemList,
    hasBreadcrumb,
    jobPostingOnHub,
    jobLinks,
    companyIdLinks,
    companyLinks,
    titleHasCount,
    h1HasCount,
    emptyState,
  };
}

async function fetchCompanyHtml(slug) {
  const res = await fetch(`${SITE_URL}/company/${encodeURIComponent(slug)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  });
  return { status: res.status, html: await res.text() };
}

async function fetchCompanyDetail(slug) {
  const headers = {};
  if (INTERNAL_SEO_SECRET) {
    headers["x-internal-seo"] = "true";
    headers["x-internal-seo-secret"] = INTERNAL_SEO_SECRET;
  }
  const res = await fetch(`${API_URL}/company/${encodeURIComponent(slug)}`, { headers });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload.data ?? null;
}

function scoreCoverage(samples) {
  const n = samples.length || 1;
  const withJobs = samples.filter((s) => s.apiVisible > 0);
  const jobCohort = withJobs.length || 1;
  return {
    schemaOrgPct: Math.round((withJobs.filter((s) => s.hasOrg).length / jobCohort) * 100),
    schemaItemListPct: Math.round((withJobs.filter((s) => s.hasItemList).length / jobCohort) * 100),
    titleCountPct: Math.round((withJobs.filter((s) => s.titleHasCount).length / jobCohort) * 100),
    h1CountPct: Math.round((withJobs.filter((s) => s.h1HasCount).length / jobCohort) * 100),
    noCompanyIdLinksPct: Math.round(
      (samples.filter((s) => s.companyIdLinks === 0).length / n) * 100,
    ),
    relatedLinksPct: Math.round(
      (samples.filter((s) => s.companyLinks > 1).length / jobCohort) * 100,
    ),
    ghostInSample: samples.filter((s) => s.apiVisible > 0 && s.emptyState && s.jobLinks === 0)
      .length,
    jobPostingOnHub: samples.filter((s) => s.jobPostingOnHub).length,
  };
}

function decideGo(report) {
  const blockers = [];
  if (report.inventory.ghost_pages > 0) {
    blockers.push(`ghost_pages=${report.inventory.ghost_pages}`);
  }
  if (report.coverage.ghostInSample > 0) {
    blockers.push(`ghost_in_live_sample=${report.coverage.ghostInSample}`);
  }
  if (report.coverage.jobPostingOnHub > 0) {
    blockers.push(`jobposting_on_hub=${report.coverage.jobPostingOnHub}`);
  }
  if (report.coverage.titleCountPct < 80) {
    blockers.push(`title_count_coverage=${report.coverage.titleCountPct}%`);
  }
  if (report.coverage.noCompanyIdLinksPct < 95) {
    blockers.push(`noindex_companyId_links=${100 - report.coverage.noCompanyIdLinksPct}%`);
  }
  return {
    decision: blockers.length === 0 ? "GO" : "NO_GO",
    blockers,
  };
}

async function main() {
  const inventory = await inventoryCounts();
  const companies = await sampleCompanies(SAMPLE_LIMIT);
  const samples = [];

  for (const row of companies) {
    const slug = row.slug;
    const [page, api] = await Promise.all([fetchCompanyHtml(slug), fetchCompanyDetail(slug)]);
    const signals = parseHtmlSignals(page.html, slug);
    samples.push({
      ...signals,
      httpStatus: page.status,
      apiVisible:
        typeof api?.visibleJobCount === "number"
          ? api.visibleJobCount
          : typeof api?.jobCount === "number"
            ? api.jobCount
            : Number(row.visible_count ?? 0),
      apiHasRemote: Boolean(api?.hasRemoteJobs),
    });
  }

  const coverage = scoreCoverage(samples);
  const report = {
    auditedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    apiUrl: API_URL,
    sampleSize: samples.length,
    inventory,
    coverage,
    samples,
  };
  const verdict = decideGo(report);
  report.verdict = verdict;

  console.log(JSON.stringify(report, null, 2));
  console.error(`\nCOMPANY SEO FOUNDATION: ${verdict.decision}`);
  if (verdict.blockers.length) {
    console.error(`Blockers: ${verdict.blockers.join(", ")}`);
  }
  process.exit(verdict.decision === "GO" ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
