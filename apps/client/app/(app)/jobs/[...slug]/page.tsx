import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadJobsDiscoveryPage, stableJobFiltersKey } from "../../../../lib/jobsPageData";
import { fetchJobsRelatedSlugs } from "../../../../lib/jobsRelatedSlugs";
import {
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../../lib/seo";
import { JobsSearchPage } from "../../../../components/job/JobsSearchPage";
import {
  getCanonicalJobListingUrl,
  normalizeRelatedSlugPath,
  parseJobFiltersFromSearch,
  parseSlugWithMeta,
  filtersToSlug,
} from "../../../../lib/slug-parser";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { JobsListingFaq } from "../../../../components/seo/JobsListingFaq";
import { SeoBreadcrumbs } from "../../../../components/seo/SeoBreadcrumbs";
import type { JobItem } from "../../../../lib/api";
import { fetchSeoAggregations } from "../../../../lib/api";

const FALLBACK_RELATED_SLUGS = [
  "role/data-engineer/location/remote",
  "role/product-manager/location/us",
  "role/product-designer/location/remote",
];

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = parseSlugWithMeta(slug);
  const filters = {
    ...parsed.filters,
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
  return jobsRouteMetadata(filters, {
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: response.meta?.total ?? undefined,
  });
}

export default async function JobsSeoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = parseSlugWithMeta(slug);
  const filters = {
    ...parsed.filters,
    ...parseJobFiltersFromSearch(sp),
    surface: "seo" as const,
  };
  const canonicalPath = getCanonicalJobListingUrl(filters);
  const canonicalSlugPath = canonicalPath.split("?")[0] ?? "/jobs";
  const incomingPath = `/jobs/${slug.join("/")}`;
  if (incomingPath !== canonicalSlugPath || !parsed.validCanonical) {
    redirect(canonicalPath);
  }
  const filtersKey = stableJobFiltersKey(filters);
  const currentSlug = filtersToSlug({
    category: filters.category,
    role: filters.role,
    skills: filters.skills,
    country: filters.country,
    location: filters.location,
    isRemote: filters.isRemote,
    workType: filters.workType,
    experience: filters.experience,
  });

  const [response, relatedSlugsRaw, aggregations] = await Promise.all([
    loadJobsDiscoveryPage(filtersKey),
    fetchJobsRelatedSlugs({ currentSlug, fallback: FALLBACK_RELATED_SLUGS }),
    fetchSeoAggregations({
      filtersSlug: currentSlug,
      internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
    }),
  ]);
  const relatedSlugs = relatedSlugsRaw
    .map((s) => normalizeRelatedSlugPath(s).replace(/^\/jobs\/?/, ""))
    .filter(Boolean);

  const total = response.meta?.total ?? 0;
  const minIndex = getSeoMinJobsIndex();
  const indexable = total >= minIndex;
  const seoSummary = buildSeoSummary(response.data, filters, total, aggregations);

  const listingTop = (
    <>
      <SeoBreadcrumbs items={buildJobDiscoveryCrumbItems(filters)} />
      <JsonLdScript data={buildBreadcrumbListJsonLd(jobDiscoveryBreadcrumbJsonLdPaths(filters))} />
      {indexable ? (
        <JsonLdScript data={buildJobListingItemListJsonLd(response.data.slice(0, 10), total)} />
      ) : null}
      <section className="mt-4 rounded-xl border border-ink/10 bg-surface px-4 py-3 text-sm text-ink/75">
        <p>
          <Link href="/" className="font-semibold text-brand hover:underline">
            JobLoom
          </Link>{" "}
          helps you discover real-time jobs from company career sites in one place, then drill into focused listings like this page.
        </p>
      </section>
      <section className="mt-4 rounded-xl border border-ink/10 bg-surface px-4 py-4 text-sm text-ink/80">
        <p className="font-semibold text-ink">
          {seoSummary.summaryLine}
        </p>
        <p className="mt-1 text-ink/70">
          Updated daily. Fresh roles are clustered by date so you can prioritize faster applications.
        </p>
      </section>
      <section className="mt-4 grid gap-4 md:grid-cols-3">
        <SeoBlock
          title={seoSummary.roleLabel ? `Top skills for ${seoSummary.roleLabel} jobs` : "Top skills in this market"}
          values={seoSummary.topSkills}
        />
        <SeoBlock
          title={seoSummary.roleLabel ? `Companies hiring ${seoSummary.roleLabel}` : "Top companies hiring"}
          values={seoSummary.topCompanies}
        />
        <SeoBlock title="Hiring trends" values={seoSummary.trendLabels} />
      </section>
      <section className="mt-4 rounded-xl border border-ink/10 bg-surface px-4 py-4 text-sm">
        <h3 className="font-semibold text-ink">Salary insights</h3>
        <p className="mt-2 text-ink/75">{seoSummary.salaryLabel}</p>
      </section>
      <section className="mt-4 rounded-xl border border-ink/10 bg-surface px-4 py-4">
        <h3 className="text-sm font-semibold text-ink">Explore related searches</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {seoSummary.relatedLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </>
  );

  const listingFaq =
    total >= minIndex && total >= 8 ? <JobsListingFaq /> : null;

  return (
    <JobsSearchPage
      jobs={response.data}
      meta={response.meta}
      relatedSlugs={relatedSlugs}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}

function toTitle(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function buildSeoSummary(
  jobs: JobItem[],
  filters: Record<string, unknown>,
  total: number,
  aggregations: Awaited<ReturnType<typeof fetchSeoAggregations>>,
) {
  const skillCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const trend = new Map<string, number>();
  for (const job of jobs) {
    for (const s of job.skills ?? []) {
      const key = s.toLowerCase();
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
    companyCounts.set(job.company.name, (companyCounts.get(job.company.name) ?? 0) + 1);
    const d = new Date(job.effectivePostedAt ?? job.postedAt ?? job.createdAt ?? Date.now());
    if (!Number.isNaN(d.getTime())) {
      const key = d.toISOString().slice(0, 10);
      trend.set(key, (trend.get(key) ?? 0) + 1);
    }
  }

  const topSkills =
    aggregations.topSkills.length > 0
      ? aggregations.topSkills.slice(0, 10).map((s) => `${toTitle(s.skill)} (${s.count})`)
      : [...skillCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => `${toTitle(name)} (${count})`);
  const topCompanies =
    aggregations.topCompanies.length > 0
      ? aggregations.topCompanies.slice(0, 10).map((c) => `${c.name} (${c.count})`)
      : [...companyCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => `${name} (${count})`);
  const trendLabels =
    aggregations.hiringTrend.length > 0
      ? aggregations.hiringTrend.slice(0, 10).map((t) => `${t.day}: ${t.count}`)
      : [...trend.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 5)
          .map(([day, count]) => `${day}: ${count}`);

  const role = typeof filters.role === "string" ? filters.role : "";
  const location =
    typeof filters.country === "string"
      ? filters.country
      : typeof filters.location === "string"
        ? filters.location
        : typeof filters.workType === "string"
          ? filters.workType
          : "";
  const summaryLine = `${total.toLocaleString()} jobs found${role ? ` for ${toTitle(role)}` : ""}${
    location ? ` in ${toTitle(location)}` : ""
  }.`;
  const salary = aggregations.salary;
  const salaryLabel =
    salary.min != null && salary.max != null
      ? `Average listed salary: ${Math.round(salary.avg ?? 0).toLocaleString()} (range ${salary.min.toLocaleString()} - ${salary.max.toLocaleString()}).`
      : "Salary data is limited for this slice, but compensation insights update daily as more roles are indexed.";

  const relatedLinks = [
    role
      ? { href: `/jobs/role/${role}/location/remote`, label: `Explore remote ${toTitle(role)} jobs` }
      : null,
    { href: "/jobs/category/engineering/location/remote", label: "Explore remote engineering jobs" },
    { href: "/jobs/role/backend-developer/location/us", label: "See backend jobs in US" },
    { href: "/jobs/role/frontend-engineer/location/remote", label: "See remote frontend jobs" },
  ].filter((x): x is { href: string; label: string } => Boolean(x));

  return {
    topSkills,
    topCompanies,
    trendLabels,
    summaryLine,
    relatedLinks,
    salaryLabel,
    roleLabel: role ? toTitle(role) : "",
  };
}

function SeoBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface px-4 py-4 text-sm">
      <h3 className="font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-1 text-ink/75">
        {values.length > 0 ? values.map((v) => <li key={v}>{v}</li>) : <li>Not enough data yet</li>}
      </ul>
    </section>
  );
}
