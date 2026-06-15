import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadCompanyBySlug,
  loadCompanyHubInitialJobs,
  loadRelatedCompanies,
  stableJobFiltersKey,
} from "../../../../lib/jobsPageData";
import {
  buildBreadcrumbListJsonLd,
  buildCompanyOrganizationJsonLd,
  buildJobListingItemListJsonLd,
} from "../../../../lib/seo";
import { absoluteUrl } from "../../../../lib/seoSite";
import { decideCompanySeoPolicy } from "../../../../lib/seoIndexability";
import { CompanyHubDiscoveryLinks } from "../../../../components/company/CompanyHubDiscoveryLinks";
import { CompanyHubPage } from "../../../../components/company/CompanyHubPage";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { SeoBreadcrumbs } from "../../../../components/seo/SeoBreadcrumbs";
import { parseJobFiltersFromSearch } from "../../../../lib/slug-parser";

const HUB_LIMIT = 20;
const ITEM_LIST_SCHEMA_JOBS = 10;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function companyVisibleJobCount(
  company: Awaited<ReturnType<typeof loadCompanyBySlug>>,
): number | null {
  if (typeof company?.visibleJobCount === "number") return company.visibleJobCount;
  if (typeof company?.jobCount === "number") return company.jobCount;
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const company = await loadCompanyBySlug(slug);
  if (!company) {
    return {
      title: "Company not found | JobLoom",
      robots: { index: false, follow: true },
    };
  }
  const visible = companyVisibleJobCount(company);
  const open = visible != null && visible > 0 ? visible : null;
  const title =
    open != null
      ? `${open.toLocaleString()} open jobs at ${company.name} | JobLoom`
      : `${company.name} careers & jobs | JobLoom`;
  const description =
    open != null
      ? `Explore ${open.toLocaleString()} open roles at ${company.name}. Apply early.`
      : `Explore careers at ${company.name} on JobLoom. Apply early when new roles are posted.`;
  const canonical = absoluteUrl(`/company/${slug}`);
  const companyGateEnabled = process.env.SEO_COMPANY_QUALITY_GATE_ENABLED === "true";
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  let decision = decideCompanySeoPolicy({
    gateEnabled: companyGateEnabled,
    company: { id: company.id, name: company.name, slug: company.slug },
    requestedSlug: slug,
    visibleJobCount: visible,
  });
  if (forceNoindexAll) {
    decision = { ...decision, index: false, follow: true, sitemapEligible: false };
  } else if (disableAllNoindex) {
    decision = { ...decision, index: true, follow: true };
  }

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: decision.index, follow: decision.follow },
  };
}

function searchRecord(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") raw[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") raw[k] = v[0];
  }
  return raw;
}

export default async function CompanyDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const company = await loadCompanyBySlug(slug);
  if (!company) notFound();

  const parsed = parseJobFiltersFromSearch(searchRecord(sp));
  const { companyId: _cid, ...hubFilters } = parsed;
  const limit =
    hubFilters.limit && hubFilters.limit >= 1 && hubFilters.limit <= 100
      ? hubFilters.limit
      : HUB_LIMIT;

  const hubFiltersKey = stableJobFiltersKey(hubFilters);
  const [initialListing, relatedCompanies] = await Promise.all([
    loadCompanyHubInitialJobs(slug, hubFiltersKey, limit),
    loadRelatedCompanies(slug),
  ]);
  const metaFromListing = initialListing.meta;
  const visibleCount = companyVisibleJobCount(company);
  const meta = {
    ...metaFromListing,
    total:
      (metaFromListing.total ?? 0) > 0
        ? metaFromListing.total
        : visibleCount ?? metaFromListing.total ?? 0,
    totalCount:
      (metaFromListing.totalCount ?? metaFromListing.total ?? 0) > 0
        ? (metaFromListing.totalCount ?? metaFromListing.total)
        : visibleCount ?? metaFromListing.totalCount ?? metaFromListing.total ?? 0,
  };

  const schemaJobs = initialListing.jobs.slice(0, ITEM_LIST_SCHEMA_JOBS);
  const listTotal =
    typeof meta.total === "number" && meta.total > 0
      ? meta.total
      : visibleCount ?? schemaJobs.length;

  return (
    <>
      <JsonLdScript
        data={buildBreadcrumbListJsonLd([
          { name: "Home", path: "/" },
          { name: "Companies", path: "/companies" },
          { name: company?.name ?? slug, path: `/company/${slug}` },
        ])}
      />
      {company ? (
        <JsonLdScript
          data={buildCompanyOrganizationJsonLd({
            name: company.name,
            slug: company.slug,
            domain: company.domain,
            logoUrl: company.logoUrl,
            careersUrl: company.careersUrl,
            visibleJobCount: visibleCount,
          })}
        />
      ) : null}
      {schemaJobs.length > 0 ? (
        <JsonLdScript data={buildJobListingItemListJsonLd(schemaJobs, listTotal)} />
      ) : null}
      <div className="mx-auto w-[92%] max-w-6xl px-2 pt-6 sm:px-4">
        <SeoBreadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Companies", href: "/companies" },
            { name: company?.name ?? slug },
          ]}
        />
        <section className="mb-4 rounded-xl border border-ink/10 bg-surface px-4 py-3 text-sm text-ink/75">
          <p>
            <Link href="/" className="font-semibold text-brand hover:underline">
              JobLoom
            </Link>{" "}
            centralizes real-time jobs from company career sites, so company pages like this stay connected to broader discovery on the homepage and listings.
          </p>
        </section>
        <CompanyHubDiscoveryLinks jobs={initialListing.jobs} />
      </div>
      <CompanyHubPage
        company={company}
        slug={slug}
        initialJobs={initialListing.jobs}
        initialMeta={meta}
        relatedCompanies={relatedCompanies}
      />
    </>
  );
}
