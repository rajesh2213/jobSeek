import type { BlogCtaLocation } from "../../../lib/analytics/blogFunnel";
import { BlogTrackedCtaLink } from "./BlogTrackedCtaLink";

export function BlogMidCta({
  href,
  label,
  article,
}: {
  href: string;
  label: string;
  article: string;
}) {
  return (
    <aside className="my-12 rounded-2xl border border-brand/20 bg-brand/[0.06] px-6 py-8 text-center shadow-card sm:px-8">
      <p className="text-sm leading-relaxed text-ink-muted">
        Skip the crowded boards. Browse roles closer to when companies publish them.
      </p>
      <div className="mt-5">
        <BlogTrackedCtaLink
          href={href}
          label={label}
          article={article}
          location={"middle" satisfies BlogCtaLocation}
          className="inline-flex rounded-full bg-brand px-6 py-2.5 text-sm font-bold !text-white transition-colors hover:bg-brand-hover"
        />
      </div>
    </aside>
  );
}
