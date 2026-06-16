import Link from "next/link";
import type { BlogPostMeta } from "../../../lib/blog/posts";
import { blogPostPath } from "../../../lib/blog/posts";
import { formatBlogPublishedDate } from "../../../lib/blog/formatBlogDate";

export function BlogPostCard({ post }: { post: BlogPostMeta }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface px-5 py-6 shadow-card transition-shadow hover:shadow-[0_12px_32px_rgba(20,20,20,0.07)] sm:px-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/55">
        {post.status === "coming_soon" ? (
          <span className="rounded-full border border-brand/25 bg-brand/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
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
      <h2 className="mt-3 font-sans text-xl font-bold text-ink sm:text-2xl">
        <Link href={blogPostPath(post.slug)} prefetch={false} className="hover:text-brand hover:underline">
          {post.title}
        </Link>
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">{post.subtitle}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink/70">{post.description}</p>
      <p className="mt-5">
        <Link
          href={blogPostPath(post.slug)}
          prefetch={false}
          className="inline-flex rounded-full border border-brand/25 bg-brand/[0.06] px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:!text-white"
        >
          {post.status === "coming_soon" ? "Preview article →" : "Read article →"}
        </Link>
      </p>
    </article>
  );
}
