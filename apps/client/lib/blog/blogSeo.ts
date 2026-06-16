import { absoluteUrl, getSiteBaseUrl } from "../seoSite";
import type { BlogPostMeta } from "./posts";
import { blogPostPath } from "./posts";

export function buildArticleJsonLd(post: BlogPostMeta): Record<string, unknown> {
  const url = absoluteUrl(blogPostPath(post.slug));
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: {
      "@type": "Organization",
      name: "JobLoom Team",
      url: getSiteBaseUrl(),
    },
    publisher: {
      "@type": "Organization",
      name: "JobLoom",
      url: getSiteBaseUrl(),
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    image: absoluteUrl("/og-image.png"),
  };
}

export function buildBlogBreadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${base}${item.path.startsWith("/") ? item.path : `/${item.path}`}`,
    })),
  };
}
