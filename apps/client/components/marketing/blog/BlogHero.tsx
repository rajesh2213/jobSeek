import type { BlogPostMeta } from "../../../lib/blog/posts";
import { formatBlogPublishedDate } from "../../../lib/blog/formatBlogDate";

export function BlogHero({ post }: { post: BlogPostMeta }) {
  return (
    <header className="border-b border-line pb-10">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">JobLoom Blog</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,6vw,2.75rem)] leading-[1.08] tracking-tight text-ink">
        {post.title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">{post.subtitle}</p>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink/60">
        <time dateTime={post.publishedAt}>{formatBlogPublishedDate(post.publishedAt)}</time>
        <span aria-hidden className="hidden h-1 w-1 rounded-full bg-ink/25 sm:inline-block" />
        <span>{post.readingTimeMinutes} min read</span>
      </div>
    </header>
  );
}
