import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_JOBS_RESPONSE, weeklyJobsPostedEnvOverride } from "../../../lib/jobsPageData";
import {
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../lib/seo";
import { JobsSearchPage } from "../../../components/job/JobsSearchPage";
import { redirect } from "next/navigation";
import { getCanonicalJobListingUrl, parseJobFiltersFromSearch } from "../../../lib/slug-parser";
import { decideJobsListingSeoPolicy } from "../../../lib/seoIndexability";
import { JsonLdScript } from "../../../components/seo/JsonLdScript";
import { JobsListingFaq } from "../../../components/seo/JobsListingFaq";
import { SeoBreadcrumbs } from "../../../components/seo/SeoBreadcrumbs";

const FALLBACK_RELATED_SLUGS = [
  "role/react-developer/location/remote",
  "role/salesforce-specialist/location/us",
  "role/marketing-manager/location/remote",
];

export const revalidate = 300;

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const searchParamKeys = Object.keys(sp).filter(Boolean).sort();
  return jobsRouteMetadata(filters, {
    routeKind: "jobs-root",
    searchParamKeys,
    canonicalPath: getCanonicalJobListingUrl(filters),
  });
}

export default async function JobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const searchParamKeys = Object.keys(sp).filter(Boolean).sort();
  if (searchParamKeys.length > 0) {
    const canonical = getCanonicalJobListingUrl(filters);
    const incomingQs = new URLSearchParams();
    for (const key of searchParamKeys) {
      const raw = sp[key];
      if (typeof raw === "string" && raw.length > 0) incomingQs.set(key, raw);
    }
    const incoming = incomingQs.toString() ? `/jobs?${incomingQs.toString()}` : "/jobs";
    if (incoming !== canonical) {
      redirect(canonical);
    }
  }

  /** Client hydrates listings — avoids Vercel SSR timeout when API pool is busy. */
  const response = EMPTY_JOBS_RESPONSE;

  const total = response.meta?.total ?? 0;
  const policy = decideJobsListingSeoPolicy({
    routeKind: "jobs-root",
    filters,
    searchParamKeys: Object.keys(sp).filter(Boolean).sort(),
    canonicalPath: getCanonicalJobListingUrl(filters),
  });
  const forceNoindexAll = process.env.SEO_FORCE_NOINDEX_ALL === "true";
  const disableAllNoindex = process.env.SEO_DISABLE_ALL_NOINDEX === "true";
  const indexable = forceNoindexAll ? false : disableAllNoindex ? true : policy.index;
  const minIndex = getSeoMinJobsIndex();

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
          finds jobs directly from company career sites before they appear on many major job boards, so you can apply earlier from one search surface.
        </p>
      </section>
    </>
  );

  const listingFaq =
    total >= minIndex && total >= 8 ? <JobsListingFaq /> : null;

  const weeklyFromEnv = weeklyJobsPostedEnvOverride();

  // Hero weekly stat: `JOBS_WEEKLY_POSTED_OVERRIDE` when set; otherwise StatsStrip shows 0 (list API has no total).
  return (
    <JobsSearchPage
      jobs={response.data}
      meta={response.meta}
      weeklyJobsPosted={weeklyFromEnv ?? undefined}
      relatedSlugs={FALLBACK_RELATED_SLUGS}
      listingTop={listingTop}
      listingFaq={listingFaq}
    />
  );
}
