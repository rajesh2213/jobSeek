import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../lib/slug-parser";

function topCounts(items: string[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

/** Internal links from company hub jobs — zero extra API calls. */
export function CompanyHubDiscoveryLinks({ jobs }: { jobs: JobItem[] }) {
  if (jobs.length === 0) return null;

  const categories = topCounts(
    jobs.map((j) => j.category).filter(Boolean),
    3,
  );
  const skills = topCounts(jobs.flatMap((j) => j.skills ?? []), 6);

  const links: Array<{ href: string; label: string }> = [];
  for (const cat of categories) {
    const href = buildJobsListingUrl({ category: cat });
    if (isCanonicalListingPath(href)) {
      links.push({ href, label: `${cat.replace(/-/g, " ")} jobs` });
    }
  }
  for (const skill of skills) {
    const href = buildJobsListingUrl({ skills: [skill] });
    if (isCanonicalListingPath(href)) {
      links.push({ href, label: `${skill.replace(/-/g, " ")} jobs` });
    }
  }

  if (links.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-ink/10 bg-surface px-4 py-3">
      <h3 className="text-xs font-semibold text-ink">Explore related job searches</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {links.map((item) => (
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
  );
}
