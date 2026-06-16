import type { Metadata } from "next";
import { absoluteUrl } from "../seoSite";
import type { BlogPostMeta } from "./posts";
import { blogPostPath } from "./posts";

export function buildBlogArticleMetadata(post: BlogPostMeta): Metadata {
  const path = blogPostPath(post.slug);
  const pageTitle = `${post.title} | JobLoom`;
  const pageUrl = absoluteUrl(path);

  return {
    title: pageTitle,
    description: post.description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: pageTitle,
      description: post.description,
      url: pageUrl,
      siteName: "JobLoom",
      type: "article",
      publishedTime: post.publishedAt,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: post.description,
      images: ["/og-image.png"],
    },
    robots: { index: true, follow: true },
  };
}
