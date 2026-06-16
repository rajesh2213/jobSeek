import type { Metadata } from "next";
import Link from "next/link";
import { BlogPosthogTracker } from "../../../../components/analytics/BlogPosthogTracker";
import { BlogArticleShell } from "../../../../components/marketing/blog/BlogArticleShell";
import { BlogAuthor } from "../../../../components/marketing/blog/BlogAuthor";
import { BlogEndCta } from "../../../../components/marketing/blog/BlogEndCta";
import { BlogHero } from "../../../../components/marketing/blog/BlogHero";
import { BlogMidCta } from "../../../../components/marketing/blog/BlogMidCta";
import { BlogRelatedReading } from "../../../../components/marketing/blog/BlogRelatedReading";
import { JobDiscoveryTimeline } from "../../../../components/marketing/blog/JobDiscoveryTimeline";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { buildBlogArticleMetadata } from "../../../../lib/blog/blogPageMetadata";
import { buildArticleJsonLd, buildBlogBreadcrumbJsonLd } from "../../../../lib/blog/blogSeo";
import { blogPostPath, getBlogPost, getRelatedPosts, type BlogPostMeta } from "../../../../lib/blog/posts";

const SLUG = "why-youre-probably-finding-jobs-too-late";

function getPostOrThrow(): BlogPostMeta {
  const found = getBlogPost(SLUG);
  if (!found) {
    throw new Error(`Missing blog post: ${SLUG}`);
  }
  return found;
}

const post = getPostOrThrow();
const PATH = blogPostPath(SLUG);
const relatedPosts = getRelatedPosts(SLUG, 2);

export const metadata: Metadata = buildBlogArticleMetadata(post);

const articleJsonLd = buildArticleJsonLd(post);
const breadcrumbJsonLd = buildBlogBreadcrumbJsonLd([
  { name: "Home", path: "/" },
  { name: "Blog", path: "/blog" },
  { name: post.title, path: PATH },
]);

const articleTypography =
  "mt-10 space-y-6 text-base leading-relaxed text-ink/90 [&_h2]:scroll-mt-24 [&_h2]:pt-4 [&_h2]:font-sans [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_h2]:sm:text-2xl [&_p+p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_li]:pl-0.5 [&_a]:font-medium [&_a]:text-brand [&_a]:hover:underline";

export default function WhyYoureFindingJobsTooLatePage() {
  return (
    <>
      <BlogPosthogTracker article={SLUG} />
      <JsonLdScript data={articleJsonLd} />
      <JsonLdScript data={breadcrumbJsonLd} />
      <BlogArticleShell>
        <BlogHero post={post} />

        <article className={articleTypography}>
          <p>A few months ago I noticed something frustrating.</p>
          <p>
            I&apos;d find a job on LinkedIn that looked perfect, click apply, and immediately see hundreds of
            applicants.
          </p>
          <p>Sometimes the posting was less than a day old.</p>
          <p>Other times it had only been up for a few hours.</p>
          <p>It felt impossible to compete.</p>
          <p>The more I looked into it, the more I realized:</p>
          <p>LinkedIn usually isn&apos;t where a job starts.</p>
          <p>It&apos;s where you see it later.</p>

          <h2>Where Jobs Actually Appear First</h2>
          <p>
            When a company opens a new role, recruiters typically create it inside their applicant tracking system
            (ATS).
          </p>
          <p>
            Platforms like Greenhouse, Lever, Ashby, and Workday power career pages for thousands of companies.
          </p>
          <p>
            The moment a recruiter publishes a job, it often appears on the company&apos;s careers page first.
          </p>
          <p>Only after that does it get distributed to job boards and aggregators.</p>
          <p>The exact timing varies, but the pattern is common.</p>
          <p>The earlier you find a role, the smaller the competition pool tends to be.</p>

          <JobDiscoveryTimeline />

          <h2>Why Being Early Matters</h2>
          <p>Recruiters don&apos;t wait for every application to arrive before reviewing candidates.</p>
          <p>Applications often start getting reviewed as soon as they come in.</p>
          <p>Imagine a recruiter receives 40 strong applications during the first day.</p>
          <p>A handful of candidates move to interviews.</p>
          <p>Then the job gets pushed to major job boards and suddenly another 500 applications arrive.</p>
          <p>At that point, the recruiter may already have several promising candidates in the pipeline.</p>
          <p>The later you apply, the harder it becomes to stand out.</p>
          <p>This doesn&apos;t mean early applicants automatically get hired.</p>
          <p>But it does mean they often get seen first.</p>
          <p>And that&apos;s a huge advantage.</p>

          <h2>The Problem With Traditional Job Boards</h2>
          <p>Job boards are incredibly useful.</p>
          <p>The problem is that everyone is looking at the same listings.</p>
          <p>
            When a job appears on LinkedIn or Indeed, thousands of people can discover it at exactly the same time.
          </p>
          <p>That creates massive competition.</p>
          <p>As a job seeker, you&apos;re essentially joining the queue after it has already formed.</p>
          <p>The best opportunities aren&apos;t always hidden.</p>
          <p>They&apos;re just discovered earlier.</p>

          <BlogMidCta href="/jobs" label="Start Finding Jobs Earlier" article={SLUG} />

          <h2>Why I Built JobLoom</h2>
          <p>JobLoom started with a simple idea:</p>
          <p>What if job seekers could discover opportunities closer to when companies publish them?</p>
          <p>
            Instead of relying entirely on traditional job boards, JobLoom monitors company career sites and
            applicant tracking systems to surface opportunities earlier.
          </p>
          <p>
            The goal isn&apos;t to flood you with more jobs. It&apos;s to help you find relevant{" "}
            <Link href="/jobs" prefetch={false}>
              jobs
            </Link>{" "}
            sooner.
          </p>
          <p>
            JobLoom also analyzes your resume and provides a match score so you can quickly identify which
            opportunities are worth your time.
          </p>
          <p>
            Instead of spending hours applying everywhere, you can focus on roles that actually fit your experience.
            See{" "}
            <Link href="/pricing" prefetch={false}>
              pricing
            </Link>{" "}
            for plans that include resume-aware matching.
          </p>

          <h2>Finding Jobs Earlier Won&apos;t Guarantee an Offer</h2>
          <p>Nothing can guarantee a job offer.</p>
          <p>But finding opportunities earlier gives you something every applicant wants:</p>
          <ul>
            <li>More time</li>
            <li>More visibility</li>
            <li>Less competition</li>
          </ul>
          <p>
            If you&apos;ve ever opened a job posting and immediately seen hundreds of applicants, you&apos;ve
            probably experienced this problem firsthand.
          </p>
          <p>The best time to apply is often before everyone else knows the job exists.</p>
          <p>That&apos;s exactly why JobLoom exists.</p>
          <p>
            Try JobLoom today and discover opportunities directly from company career pages before they get buried
            under hundreds of applications.
          </p>
        </article>

        <BlogRelatedReading posts={relatedPosts} currentSlug={SLUG} />

        <BlogEndCta
          headline="Ready to discover opportunities before everyone else?"
          buttonLabel="Browse Fresh Jobs"
          href="/jobs"
          article={SLUG}
        />

        <BlogAuthor name="JobLoom Team" />

        <p className="mt-10 text-center text-sm">
          <Link href="/blog" className="font-medium text-brand hover:text-brand-hover hover:underline" prefetch={false}>
            ← Back to blog
          </Link>
        </p>
      </BlogArticleShell>
    </>
  );
}
