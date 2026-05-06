import Link from "next/link";
import { buildJobsListingUrl, isCanonicalListingPath } from "../../lib/slug-parser";
import { mergeBrowseSkillQueries } from "../../lib/seoSkillTokens";

const defaultSkillQueries = ["react", "typescript", "nodejs", "python"];
const roleQueries = ["backend-developer", "frontend-engineer", "data-engineer", "product-manager"];
const locationQueries = ["US", "IN", "remote", "DE"];

function BrowseGroup({
  title,
  hrefBuilder,
  values,
}: {
  title: string;
  hrefBuilder: (v: string) => string;
  values: string[];
}) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.map((v) => (
          (() => {
            const href = hrefBuilder(v);
            if (!isCanonicalListingPath(href)) return null;
            return (
              <Link
                key={`${title}-${v}`}
                href={href}
                className="rounded-full bg-surface px-3 py-1.5 text-sm text-ink/70 no-underline ring-1 ring-ink/10 hover:text-brand"
              >
                {v === "US"
                  ? "United States"
                  : v === "IN"
                    ? "India"
                    : v === "DE"
                      ? "Germany"
                      : v.replace(/-/g, " ")}
              </Link>
            );
          })()
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
        title="Browse by skills"
        values={skillQueries}
        hrefBuilder={(s) => buildJobsListingUrl({ skills: [s.toLowerCase()] })}
      />
      <BrowseGroup
        title="Browse by role"
        values={roleQueries}
        hrefBuilder={(r) =>
          buildJobsListingUrl({ role: r, roles: [r] })
        }
      />
      <BrowseGroup
        title="Browse by location"
        values={locationQueries}
        hrefBuilder={(loc) =>
          loc === "remote"
            ? buildJobsListingUrl({
                workTypes: ["remote"],
                workType: "remote",
                isRemote: true,
              })
            : loc === "US" || loc === "IN" || loc === "DE"
              ? buildJobsListingUrl({ country: loc })
              : buildJobsListingUrl({ locations: [loc] })
        }
      />
    </section>
  );
}
