import type { Metadata } from "next";
import { CompaniesSearchPage } from "../../../components/companies/CompaniesSearchPage";
import { absoluteUrl } from "../../../lib/seoSite";

export const metadata: Metadata = {
  title: "Companies | JobLoom",
  description:
    "Browse employers hiring now: tech companies careers, remote companies hiring, and startup jobs. Explore open roles and apply early.",
  alternates: { canonical: absoluteUrl("/companies") },
  robots: { index: true, follow: true },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const EMPTY_COMPANIES_META = {
  page: 1,
  limit: 24,
  total: 0,
  totalPages: 1,
  hasMore: false,
  stats: { totalTracked: 0, hiringThisWeek: 0, activeHiringCompanies: 0 },
} as const;

/** Client hydrates — avoids blocking SSR on slow `/companies` aggregation. */
export default async function CompaniesPage({ searchParams }: Props) {
  await searchParams;

  return (
    <CompaniesSearchPage initialCompanies={[]} initialMeta={EMPTY_COMPANIES_META} />
  );
}
