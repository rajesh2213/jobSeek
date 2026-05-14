import Link from "next/link";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../lib/slug-parser";
import { mergeBrowseSkillQueries } from "../../lib/seoSkillTokens";

const defaultSkillQueries = ["react", "typescript", "nodejs", "python"];
const roleQueries = ["backend-developer", "frontend-engineer", "data-engineer", "product-manager"];
const locationQueries = ["US", "IN", "remote", "DE", "GB", "CA"];
const categoryQueries = ["engineering", "data", "product", "design", "security", "infrastructure"];

const LOCATION_LABEL: Record<string, string> = {
  US: "United States",
  IN: "India",
  DE: "Germany",
  GB: "United Kingdom",
  CA: "Canada",
};

function BrowseGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{ href: string; label: string }>;
}) {
  const filtered = items.filter((item) => isCanonicalListingPath(item.href));
  if (filtered.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {filtered.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-full bg-surface px-3 py-1.5 text-sm text-ink/70 no-underline ring-1 ring-ink/10 hover:text-brand"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SeoFooterLinks(props?: { browseSkills?: string[] }) {
  const skillQueries = mergeBrowseSkillQueries(
    props?.browseSkills ?? [],
    defaultSkillQueries,
    12,
  );
  return (
    <section className="mt-16 space-y-8 border-t border-ink/10 py-8">
      <p className="text-sm text-ink/70">
        Find more real-time jobs on{" "}
        <Link href="/" className="font-semibold text-brand no-underline hover:underline">
          JobLoom
        </Link>
        .
      </p>
      <BrowseGroup
        title="Browse by category"
        items={categoryQueries.map((c) => ({
          href: buildJobsListingUrl({ category: c }),
          label: c.replace(/-/g, " "),
        }))}
      />
      <BrowseGroup
        title="Browse by skills"
        items={skillQueries.map((s) => ({
          href: buildJobsListingUrl({ skills: [s.toLowerCase()] }),
          label: s,
        }))}
      />
      <BrowseGroup
        title="Browse by role"
        items={roleQueries.map((r) => ({
          href: buildJobsListingUrl({ role: r, roles: [r] }),
          label: r.replace(/-/g, " "),
        }))}
      />
      <BrowseGroup
        title="Browse by location"
        items={locationQueries.map((loc) => ({
          href:
            loc === "remote"
              ? buildJobsListingUrl({ workType: "remote", isRemote: true })
              : buildJobsListingUrl({ country: loc }),
          label: LOCATION_LABEL[loc] ?? loc.replace(/-/g, " "),
        }))}
      />
    </section>
  );
}
