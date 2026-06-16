import { captureEvent, withPosthogAttribution } from "../posthog";

export type BlogCtaLocation = "middle" | "bottom";

export function trackBlogArticleViewed(article: string): void {
  captureEvent(
    "blog_article_viewed",
    withPosthogAttribution({
      article,
    }),
  );
}

export function trackBlogCtaClicked(article: string, location: BlogCtaLocation): void {
  captureEvent(
    "blog_cta_clicked",
    withPosthogAttribution({
      article,
      location,
    }),
  );
}
