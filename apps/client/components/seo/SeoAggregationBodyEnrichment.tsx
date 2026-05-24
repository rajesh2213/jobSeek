import Link from "next/link";
import type { SeoAggregationsData } from "../../lib/seoAggregations";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../lib/slug-parser";

function formatSkillLabel(skill: string): string {
  return skill.replace(/-/g, " ");
}

type CompanyRow = {
  companyId: string;
  name: string;
  count: number;
  slug?: string | null;
};

/**
 * In-page enrichment from SSR aggregation data (no extra fetch).
 * Renders only when there is enough signal — avoids thin duplicate blocks.
 */
export function SeoAggregationBodyEnrichment({ data }: { data: SeoAggregationsData }) {
  const skills = data.topSkills.filter((s) => s.count > 0).slice(0, 8);
  const companies = (data.topCompanies as CompanyRow[]).filter((c) => c.count > 0).slice(0, 6);

  const showSkills = skills.length >= 3;
  const showCompanies = companies.length >= 2;

  if (!showSkills && !showCompanies) return null;

  return (
    <div className="mt-3 space-y-3 sm:mt-4">
      {showSkills ? (
        <section className="rounded-xl border border-ink/10 bg-surface px-3 py-3 sm:px-4 sm:py-4">
          <h3 className="text-xs font-semibold text-ink sm:text-sm">Trending skills in these results</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5 sm:mt-2 sm:gap-2">
            {skills.map(({ skill, count }) => {
              const href = buildJobsListingUrl({ skills: [skill] });
              const label = `${formatSkillLabel(skill)} (${count.toLocaleString()})`;
              if (!isCanonicalListingPath(href)) {
                return (
                  <span
                    key={skill}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink/75 ring-1 ring-ink/10"
                  >
                    {label}
                  </span>
                );
              }
              return (
                <Link
                  key={skill}
                  href={href}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {showCompanies ? (
        <section className="rounded-xl border border-ink/10 bg-surface px-3 py-3 sm:px-4 sm:py-4">
          <h3 className="text-xs font-semibold text-ink sm:text-sm">Top hiring companies</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-ink/80">
            {companies.map((c) => {
              const href = c.slug?.trim() ? `/company/${c.slug.trim()}` : null;
              return (
                <li key={c.companyId} className="flex items-center justify-between gap-2">
                  {href ? (
                    <Link
                      href={href}
                      className="truncate font-medium text-ink no-underline hover:text-brand"
                    >
                      {c.name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-ink">{c.name}</span>
                  )}
                  <span className="shrink-0 text-xs text-ink/45">
                    {c.count.toLocaleString()} roles
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
