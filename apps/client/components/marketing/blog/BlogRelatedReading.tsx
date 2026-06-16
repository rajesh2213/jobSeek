import Link from "next/link";
import type { BlogPostMeta } from "../../../lib/blog/posts";
import { blogPostPath } from "../../../lib/blog/posts";
import { formatBlogPublishedDate } from "../../../lib/blog/formatBlogDate";

export function BlogRelatedReading({
  posts,
  currentSlug,
}: {
  posts: BlogPostMeta[];
  currentSlug: string;
}) {
  const related = posts.filter((post) => post.slug !== currentSlug);
  if (related.length === 0) return null;

  return (
    <section aria-labelledby="related-reading-heading" className="mt-14 border-t border-line pt-10">
      <h2 id="related-reading-heading" className="font-sans text-xl font-bold text-ink sm:text-2xl">
        Related Reading
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {related.map((post) => (
          <li key={post.slug}>
            <article className="flex h-full flex-col rounded-2xl border border-line bg-surface px-5 py-5 shadow-card transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,20,0.07)] sm:px-6">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/55">
                {post.status === "coming_soon" ? (
                  <span className="rounded-full border border-brand/25 bg-brand/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                    Coming soon
                  </span>
                ) : (
                  <>
                    <time dateTime={post.publishedAt}>{formatBlogPublishedDate(post.publishedAt)}</time>
                    <span aria-hidden>·</span>
                    <span>{post.readingTimeMinutes} min read</span>
                  </>
                )}
              </div>
              <h3 className="mt-3 font-sans text-base font-bold text-ink sm:text-lg">
                <Link href={blogPostPath(post.slug)} prefetch={false} className="hover:text-brand hover:underline">
                  {post.title}
                </Link>
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{post.subtitle}</p>
              <p className="mt-4">
                <Link
                  href={blogPostPath(post.slug)}
                  prefetch={false}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  {post.status === "coming_soon" ? "Preview article →" : "Read article →"}
                </Link>
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
