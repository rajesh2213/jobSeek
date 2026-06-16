"use client";

import { trackBlogArticleViewed } from "../../lib/analytics/blogFunnel";
import { usePosthogStableMicrotask } from "../../lib/posthog";

interface Props {
  article: string;
}

/** Fires `blog_article_viewed` once per stable mount (StrictMode-safe). */
export function BlogPosthogTracker({ article }: Props) {
  usePosthogStableMicrotask(() => {
    trackBlogArticleViewed(article);
  }, [article]);

  return null;
}
