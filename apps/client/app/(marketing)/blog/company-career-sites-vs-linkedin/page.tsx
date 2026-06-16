import { BlogPosthogTracker } from "../../../../components/analytics/BlogPosthogTracker";
import { BlogStubArticle } from "../../../../components/marketing/blog/BlogStubArticle";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { buildBlogArticleMetadata } from "../../../../lib/blog/blogPageMetadata";
import { buildArticleJsonLd, buildBlogBreadcrumbJsonLd } from "../../../../lib/blog/blogSeo";
import { blogPostPath, getBlogPost, type BlogPostMeta } from "../../../../lib/blog/posts";

const SLUG = "company-career-sites-vs-linkedin";

function getPostOrThrow(): BlogPostMeta {
  const found = getBlogPost(SLUG);
  if (!found) throw new Error(`Missing blog post: ${SLUG}`);
  return found;
}

const post = getPostOrThrow();
const PATH = blogPostPath(SLUG);

export const metadata = buildBlogArticleMetadata(post);

const articleJsonLd = buildArticleJsonLd(post);
const breadcrumbJsonLd = buildBlogBreadcrumbJsonLd([
  { name: "Home", path: "/" },
  { name: "Blog", path: "/blog" },
  { name: post.title, path: PATH },
]);

export default function CompanyCareerSitesVsLinkedInPage() {
  return (
    <>
      <BlogPosthogTracker article={SLUG} />
      <JsonLdScript data={articleJsonLd} />
      <JsonLdScript data={breadcrumbJsonLd} />
      <BlogStubArticle post={post} />
    </>
  );
}
