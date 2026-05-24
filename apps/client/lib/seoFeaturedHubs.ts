/** Featured SEO hub URLs for browse page and GSC indexing requests. */
export const FEATURED_SEO_HUBS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/jobs/skill/typescript", label: "TypeScript jobs" },
  { href: "/jobs/skill/python", label: "Python jobs" },
  { href: "/jobs/skill/react", label: "React jobs" },
  { href: "/jobs/skill/javascript", label: "JavaScript jobs" },
  { href: "/jobs/skill/java", label: "Java jobs" },
  { href: "/jobs/category/engineering", label: "Engineering jobs" },
  { href: "/jobs/category/data", label: "Data jobs" },
  { href: "/jobs/category/product", label: "Product jobs" },
  { href: "/jobs/category/design", label: "Design jobs" },
  { href: "/jobs/location/remote", label: "Remote jobs" },
  { href: "/jobs/category/engineering/location/remote", label: "Remote engineering jobs" },
  { href: "/jobs/category/data/location/remote", label: "Remote data jobs" },
  { href: "/jobs/skill/typescript/location/remote", label: "Remote TypeScript jobs" },
  { href: "/jobs/skill/python/location/us", label: "Python jobs in the US" },
  { href: "/jobs/skill/react/location/remote", label: "Remote React jobs" },
];

/** Google Search Console URL inspection deep links (manual indexing requests). */
export const GSC_INDEXING_REQUEST_URLS: ReadonlyArray<{ label: string; gscUrl: string; pageUrl: string }> =
  [
    "typescript",
    "python",
    "react",
    "javascript",
    "java",
  ].map((skill) => {
    const pageUrl = `https://www.jobloom.tech/jobs/skill/${skill}`;
    return {
      label: `${skill} skill hub`,
      pageUrl,
      gscUrl: `https://search.google.com/search-console/inspect?resource_id=sc-domain%3Ajobloom.tech&url=${encodeURIComponent(pageUrl)}`,
    };
  }).concat(
    ["engineering", "data", "product", "design", "marketing"].map((cat) => {
      const pageUrl = `https://www.jobloom.tech/jobs/category/${cat}`;
      return {
        label: `${cat} category hub`,
        pageUrl,
        gscUrl: `https://search.google.com/search-console/inspect?resource_id=sc-domain%3Ajobloom.tech&url=${encodeURIComponent(pageUrl)}`,
      };
    }),
  );
