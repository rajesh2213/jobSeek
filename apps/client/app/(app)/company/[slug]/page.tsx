import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchCompanyBySlug,
} from "../../../../lib/api";
import { buildBreadcrumbListJsonLd } from "../../../../lib/seo";
import { absoluteUrl } from "../../../../lib/seoSite";
import { CompanyHubPage } from "../../../../components/company/CompanyHubPage";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { SeoBreadcrumbs } from "../../../../components/seo/SeoBreadcrumbs";
import { parseJobFiltersFromSearch } from "../../../../lib/slug-parser";

const HUB_LIMIT = 20;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const company = await fetchCompanyBySlug(slug);
  if (!company) {
    return { title: "Company not found | JobLoom" };
  }
  const title = `${company.name} Jobs & Careers | JobLoom`;
  const description = `Explore open roles at ${company.name}. Browse engineering, product, and remote jobs—verified listings with early apply links.`;
  const canonical = absoluteUrl(`/company/${slug}`);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
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
  const company = await fetchCompanyBySlug(slug);
  if (!company) notFound();

  const parsed = parseJobFiltersFromSearch(searchRecord(sp));
  const { companyId: _cid, ...hubFilters } = parsed;
  const limit =
    hubFilters.limit && hubFilters.limit >= 1 && hubFilters.limit <= 100
      ? hubFilters.limit
      : HUB_LIMIT;

  const meta = {
    page: 1,
    pageSize: limit,
    total: 0,
    totalPages: 1,
    hasMore: false,
  };

  return (
    <>
      <JsonLdScript
        data={buildBreadcrumbListJsonLd([
          { name: "Home", path: "/" },
          { name: "Companies", path: "/companies" },
          { name: company.name, path: `/company/${slug}` },
        ])}
      />
      <div className="mx-auto w-[92%] max-w-6xl px-2 pt-6 sm:px-4">
        <SeoBreadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Companies", href: "/companies" },
            { name: company.name },
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
      </div>
      <CompanyHubPage
        company={company}
        slug={slug}
        initialJobs={[]}
        initialMeta={meta}
        relatedCompanies={[]}
      />
    </>
  );
}
