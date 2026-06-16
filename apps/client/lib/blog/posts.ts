export type BlogPostStatus = "published" | "coming_soon";

export type BlogPostMeta = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  publishedAt: string;
  readingTimeMinutes: number;
  status: BlogPostStatus;
  relatedSlugs: string[];
};

export const BLOG_POSTS: BlogPostMeta[] = [
  {
    slug: "why-youre-probably-finding-jobs-too-late",
    title: "Why You're Probably Finding Jobs Too Late",
    subtitle:
      "Most roles appear on company career pages before they reach major job boards — and that timing gap changes everything.",
    description:
      "Learn why many jobs appear on company career pages before they reach major job boards and how finding opportunities earlier can improve your job search.",
    publishedAt: "2026-06-16",
    readingTimeMinutes: 4,
    status: "published",
    relatedSlugs: ["company-career-sites-vs-linkedin", "how-to-find-jobs-before-linkedin"],
  },
  {
    slug: "company-career-sites-vs-linkedin",
    title: "Company Career Sites vs LinkedIn: Where Should You Apply First?",
    subtitle:
      "Compare timing, competition, and visibility when you apply on a company careers page versus a major job board.",
    description:
      "Should you apply on a company career site or wait for LinkedIn? Learn where roles appear first and how to prioritize your applications.",
    publishedAt: "2026-06-17",
    readingTimeMinutes: 5,
    status: "published",
    relatedSlugs: ["why-youre-probably-finding-jobs-too-late", "how-to-find-jobs-before-linkedin"],
  },
  {
    slug: "how-to-find-jobs-before-linkedin",
    title: "How to Find Jobs Before They Reach LinkedIn",
    subtitle:
      "Practical ways to monitor company career pages and ATS feeds so you discover roles before the crowd.",
    description:
      "Learn how to find jobs before they reach LinkedIn by monitoring company career sites, ATS pages, and early-ingestion job search tools.",
    publishedAt: "2026-06-18",
    readingTimeMinutes: 5,
    status: "published",
    relatedSlugs: ["why-youre-probably-finding-jobs-too-late", "company-career-sites-vs-linkedin"],
  },
];

export function getBlogPost(slug: string): BlogPostMeta | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
}

export function getRelatedPosts(slug: string, limit = 2): BlogPostMeta[] {
  const post = getBlogPost(slug);
  if (!post) return [];
  return post.relatedSlugs
    .slice(0, limit)
    .map((relatedSlug) => getBlogPost(relatedSlug))
    .filter((p): p is BlogPostMeta => Boolean(p));
}

export function getPublishedPosts(): BlogPostMeta[] {
  return BLOG_POSTS.filter((post) => post.status === "published");
}
