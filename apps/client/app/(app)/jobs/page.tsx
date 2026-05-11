import type { Metadata } from "next";
import Link from "next/link";
import {
  loadJobsDiscoveryPage,
  loadJobsListingDeferred,
  stableJobFiltersKey,
  weeklyJobsPostedEnvOverride,
} from "../../../lib/jobsPageData";
import {
  buildJobDiscoveryCrumbItems,
  buildBreadcrumbListJsonLd,
  buildJobListingItemListJsonLd,
  getSeoMinJobsIndex,
  jobDiscoveryBreadcrumbJsonLdPaths,
  jobsRouteMetadata,
} from "../../../lib/seo";
import { JobsSearchPage } from "../../../components/job/JobsSearchPage";
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
  const response = await loadJobsDiscoveryPage(stableJobFiltersKey(filters));
  const searchParamKeys = Object.keys(sp).filter(Boolean).sort();
  return jobsRouteMetadata(filters, {
    routeKind: "jobs-root",
    searchParamKeys,
    canonicalPath: getCanonicalJobListingUrl(filters),
    total: response.meta?.total ?? undefined,
  });
}

export default async function JobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseJobFiltersFromSearch(sp);
  const filtersKey = stableJobFiltersKey(filters);

  const { jobsDataPromise } = loadJobsListingDeferred({ filtersKey });
  const response = await jobsDataPromise;

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

  // B1: Skip awaiting weekly API on SSR unless ops pins `JOBS_WEEKLY_POSTED_OVERRIDE`; otherwise
  // JobsSearchClient fills the hero stat via fetchJobs (posted=1w) on mount.
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
