import Link from "next/link";
import { BlogArticleShell } from "./BlogArticleShell";
import { BlogHero } from "./BlogHero";
import { BlogRelatedReading } from "./BlogRelatedReading";
import type { BlogPostMeta } from "../../../lib/blog/posts";
import { getRelatedPosts } from "../../../lib/blog/posts";

const stubTypography =
  "mt-10 space-y-4 text-base leading-relaxed text-ink/90 [&_a]:font-medium [&_a]:text-brand [&_a]:hover:underline";

export function BlogStubArticle({ post }: { post: BlogPostMeta }) {
  const related = getRelatedPosts(post.slug, 2);

  return (
    <BlogArticleShell>
      <BlogHero post={post} />

      <article className={stubTypography}>
        <p className="rounded-xl border border-brand/20 bg-brand/[0.06] px-4 py-3 text-sm font-medium text-ink">
          Full article coming soon. In the meantime, explore our published guides below.
        </p>
        {post.slug === "company-career-sites-vs-linkedin" ? (
          <>
            <p>
              When a company opens a role, the listing often lands on its own careers page first—powered by an ATS like
              Greenhouse, Lever, or Workday—before it is syndicated to LinkedIn and other boards.
            </p>
            <p>
              Applying on the company site can mean fewer competing applicants and earlier visibility with recruiters.
              Waiting for LinkedIn often means joining a much larger queue.
            </p>
            <p>
              Read{" "}
              <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false}>
                Why You&apos;re Probably Finding Jobs Too Late
              </Link>{" "}
              for the full timeline of how jobs spread from career pages to major boards.
            </p>
          </>
        ) : (
          <>
            <p>
              The fastest way to beat the crowd is to monitor company career pages and ATS feeds—not just the job boards
              everyone else refreshes.
            </p>
            <p>
              JobLoom aggregates roles from career sites as companies publish them, so you can search one feed instead of
              checking dozens of company pages by hand.
            </p>
            <p>
              Start with{" "}
              <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false}>
                Why You&apos;re Probably Finding Jobs Too Late
              </Link>{" "}
              to understand why timing matters, then browse{" "}
              <Link href="/jobs" prefetch={false}>
                fresh jobs
              </Link>{" "}
              on JobLoom.
            </p>
          </>
        )}
      </article>

      <BlogRelatedReading posts={related} currentSlug={post.slug} />

      <p className="mt-10 text-center text-sm">
        <Link href="/blog" className="font-medium text-brand hover:text-brand-hover hover:underline" prefetch={false}>
          ← Back to blog
        </Link>
      </p>
    </BlogArticleShell>
  );
}
