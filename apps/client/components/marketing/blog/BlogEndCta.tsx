import type { BlogCtaLocation } from "../../../lib/analytics/blogFunnel";
import { BlogTrackedCtaLink } from "./BlogTrackedCtaLink";

export function BlogEndCta({
  headline,
  buttonLabel,
  href,
  article,
}: {
  headline: string;
  buttonLabel: string;
  href: string;
  article: string;
}) {
  return (
    <section className="relative mt-16 w-full lg:-ml-[112px] lg:w-[calc(100%+112px)]">
      <div className="w-full bg-[linear-gradient(135deg,#1a1a1a_0%,#111_100%)] px-4 py-10 text-center sm:px-6 sm:py-12">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand/80">Ready when you are</p>
        <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{headline}</h2>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <BlogTrackedCtaLink
            href={href}
            label={buttonLabel}
            article={article}
            location={"bottom" satisfies BlogCtaLocation}
            className="inline-flex rounded-full bg-brand px-6 py-2.5 text-sm font-bold !text-white transition-colors hover:bg-brand-hover"
          />
        </div>
      </div>
    </section>
  );
}
