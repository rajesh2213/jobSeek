import type { Metadata } from "next";
import Link from "next/link";
import { fetchJobCategories, fetchJobSkills } from "../../../../lib/api";
import { JOB_CATEGORIES } from "../../../../lib/taxonomy";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../../../lib/slug-parser";
import { Container } from "../../../../components/ui/Container";

export const metadata: Metadata = {
  title: "Browse jobs by category, skill, and location | JobLoom",
  description:
    "Explore indexed job discovery pages by category, tech stack, and location. Jump to high-signal searches with one click.",
};

const BROWSE_LOCATIONS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "remote", label: "Remote" },
  { token: "US", label: "United States" },
  { token: "IN", label: "India" },
  { token: "GB", label: "United Kingdom" },
  { token: "CA", label: "Canada" },
  { token: "DE", label: "Germany" },
  { token: "AU", label: "Australia" },
  { token: "FR", label: "France" },
  { token: "NL", label: "Netherlands" },
  { token: "SG", label: "Singapore" },
  { token: "JP", label: "Japan" },
  { token: "BR", label: "Brazil" },
];

export default async function JobsBrowsePage() {
  const [catResult, skillResult] = await Promise.allSettled([
    fetchJobCategories(),
    fetchJobSkills(),
  ]);
  const catAgg = catResult.status === "fulfilled" ? catResult.value : [];
  const skillAgg = skillResult.status === "fulfilled" ? skillResult.value : [];
  const catBySlug = new Map(catAgg.map((c) => [c.slug, c.count]));
  const topSkills = skillAgg.slice(0, 48);

  return (
    <main className="min-h-screen pb-20 pt-8">
      <Container width="readable" className="space-y-10">
        <header className="space-y-2 text-left">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink md:text-4xl">
            Browse job discovery pages
          </h1>
          <p className="text-base leading-relaxed text-ink/70">
            Categories and skills below link to filtered job listings. URLs use the same slug format as our
            programmatic SEO index.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink/45">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {JOB_CATEGORIES.filter((c) => c !== "other").map((slug) => {
              const n = catBySlug.get(slug);
              const href = buildJobsListingUrl({ category: slug });
              if (!isCanonicalListingPath(href)) return null;
              return (
                <Link
                  key={slug}
                  href={href}
                  className="rounded-full bg-surface px-3 py-1.5 text-sm text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
                >
                  {slug.replace(/-/g, " ")}
                  {typeof n === "number" ? (
                    <span className="ml-1.5 text-ink/40">({n.toLocaleString()})</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink/45">Locations</h2>
          <div className="flex flex-wrap gap-2">
            {BROWSE_LOCATIONS.map(({ token, label }) => {
              const href =
                token === "remote"
                  ? buildJobsListingUrl({ workType: "remote", isRemote: true })
                  : buildJobsListingUrl({ country: token });
              if (!isCanonicalListingPath(href)) return null;
              return (
                <Link
                  key={token}
                  href={href}
                  className="rounded-full bg-surface px-3 py-1.5 text-sm text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink/45">Top skills</h2>
          <div className="flex flex-wrap gap-2">
            {topSkills.map((s) => (
              (() => {
                const href = buildJobsListingUrl({ skills: [s.slug] });
                if (!isCanonicalListingPath(href)) return null;
                return (
                  <Link
                    key={s.slug}
                    href={href}
                    className="rounded-full bg-surface px-3 py-1.5 text-sm text-ink/80 no-underline ring-1 ring-ink/10 hover:text-brand"
                  >
                    {s.slug}
                    <span className="ml-1.5 text-ink/40">({s.count.toLocaleString()})</span>
                  </Link>
                );
              })()
            ))}
          </div>
        </section>

        <p className="text-sm text-ink/55">
          <Link href="/jobs" className="font-medium text-brand no-underline hover:underline">
            Back to all jobs
          </Link>
        </p>
      </Container>
    </main>
  );
}
