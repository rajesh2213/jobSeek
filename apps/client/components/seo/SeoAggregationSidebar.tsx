import Link from "next/link";
import type { SeoAggregationsData } from "../../lib/seoAggregations";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../lib/slug-parser";

function formatSalary(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString()}`;
}

function formatSkillLabel(skill: string): string {
  return skill.replace(/-/g, " ");
}

export function SeoAggregationSidebar({ data }: { data: SeoAggregationsData }) {
  const { topSkills, topCompanies, salary, hiringTrend } = data;
  const trend = [...hiringTrend]
    .filter((d) => d.count > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-7);
  const maxTrend = trend.reduce((m, d) => Math.max(m, d.count), 0);
  const hasSalary =
    (salary.min != null && salary.min > 0) ||
    (salary.max != null && salary.max > 0) ||
    (salary.avg != null && salary.avg > 0);

  return (
    <aside
      className="space-y-4 rounded-xl border border-ink/10 bg-surface p-4 text-sm"
      aria-label="Job market insights"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink/45">
        Market insights
      </h3>

      {hasSalary ? (
        <section className="space-y-1">
          <p className="text-xs font-semibold text-ink/70">Salary range (listed)</p>
          <p className="text-base font-semibold text-ink">
            {salary.min != null && salary.max != null
              ? `${formatSalary(salary.min)} – ${formatSalary(salary.max)}`
              : salary.avg != null
                ? `Avg ${formatSalary(salary.avg)}`
                : null}
          </p>
          {salary.avg != null && salary.min != null && salary.max != null ? (
            <p className="text-xs text-ink/55">Average {formatSalary(salary.avg)}</p>
          ) : null}
        </section>
      ) : null}

      {topSkills.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-ink/70">Top skills</p>
          <ul className="flex flex-wrap gap-1.5">
            {topSkills.slice(0, 8).map(({ skill, count }) => {
              const href = buildJobsListingUrl({ skills: [skill] });
              const canonical = isCanonicalListingPath(href);
              const label = `${formatSkillLabel(skill)} (${count.toLocaleString()})`;
              if (!canonical) {
                return (
                  <li
                    key={skill}
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-ink/75 ring-1 ring-ink/10"
                  >
                    {label}
                  </li>
                );
              }
              return (
                <li key={skill}>
                  <Link
                    href={href}
                    className="inline-block rounded-full bg-white px-2.5 py-1 text-xs text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {topCompanies.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-ink/70">Top hiring companies</p>
          <ul className="space-y-1.5 text-xs text-ink/80">
            {topCompanies.slice(0, 6).map((c) => (
              <li key={c.companyId} className="flex justify-between gap-2">
                <span className="truncate font-medium text-ink">{c.name}</span>
                <span className="shrink-0 text-ink/45">{c.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trend.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-ink/70">Hiring trend (14 days)</p>
          <div className="flex items-end gap-1" role="img" aria-label="Daily job postings trend">
            {trend.map((d) => {
              const h =
                maxTrend > 0 ? Math.max(4, Math.round((d.count / maxTrend) * 48)) : 4;
              return (
                <div
                  key={d.day}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  title={`${d.day}: ${d.count} jobs`}
                >
                  <div
                    className="w-full rounded-sm bg-brand/70"
                    style={{ height: `${h}px` }}
                  />
                  <span className="text-[9px] text-ink/40">
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
