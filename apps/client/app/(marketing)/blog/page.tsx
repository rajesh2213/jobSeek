import type { Metadata } from "next";
import Link from "next/link";
import { BlogPostCard } from "../../../components/marketing/blog/BlogPostCard";
import { DESKTOP_RAIL_INSET_CLASS } from "../../../components/layout/railInset";
import { BLOG_POSTS } from "../../../lib/blog/posts";
import { absoluteUrl } from "../../../lib/seoSite";

const PATH = "/blog";
const title = "Blog | JobLoom";
const description =
  "Job search insights from the JobLoom team — how to find roles earlier, apply smarter, and stay ahead of crowded job boards.";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: absoluteUrl(PATH),
  },
  openGraph: {
    title,
    description,
    url: absoluteUrl(PATH),
    siteName: "JobLoom",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JobLoom Blog" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export default function BlogIndexPage() {
  const posts = [...BLOG_POSTS].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return (
    <div className={`min-h-screen bg-canvas pb-24 pt-10 text-ink ${DESKTOP_RAIL_INSET_CLASS}`}>
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <header className="border-b border-line pb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">JobLoom Blog</p>
          <h1 className="mt-3 font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            Job search insights
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
            Practical guidance on finding roles earlier, applying with confidence, and making the most of JobLoom.
          </p>
        </header>

        <ul className="mt-12 space-y-6">
          {posts.map((post) => (
            <li key={post.slug}>
              <BlogPostCard post={post} />
            </li>
          ))}
        </ul>

        <p className="mt-12 text-center text-sm">
          <Link href="/jobs" className="font-medium text-brand hover:text-brand-hover hover:underline" prefetch={false}>
            ← Browse jobs
          </Link>
        </p>
      </div>
    </div>
  );
}
