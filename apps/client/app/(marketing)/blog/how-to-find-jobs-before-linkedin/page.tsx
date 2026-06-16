import type { Metadata } from "next";
import Link from "next/link";
import { BlogPosthogTracker } from "../../../../components/analytics/BlogPosthogTracker";
import { BlogArticleShell } from "../../../../components/marketing/blog/BlogArticleShell";
import { BlogAuthor } from "../../../../components/marketing/blog/BlogAuthor";
import { BlogEndCta } from "../../../../components/marketing/blog/BlogEndCta";
import { BlogHero } from "../../../../components/marketing/blog/BlogHero";
import { BlogMidCta } from "../../../../components/marketing/blog/BlogMidCta";
import { BlogRelatedReading } from "../../../../components/marketing/blog/BlogRelatedReading";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { buildBlogArticleMetadata } from "../../../../lib/blog/blogPageMetadata";
import { buildArticleJsonLd, buildBlogBreadcrumbJsonLd } from "../../../../lib/blog/blogSeo";
import { blogPostPath, getBlogPost, getRelatedPosts, type BlogPostMeta } from "../../../../lib/blog/posts";

const SLUG = "how-to-find-jobs-before-linkedin";

function getPostOrThrow(): BlogPostMeta {
  const found = getBlogPost(SLUG);
  if (!found) throw new Error(`Missing blog post: ${SLUG}`);
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

export default function HowToFindJobsBeforeLinkedInPage() {
  return (
    <>
      <BlogPosthogTracker article={SLUG} />
      <JsonLdScript data={articleJsonLd} />
      <JsonLdScript data={breadcrumbJsonLd} />
      <BlogArticleShell>
        <BlogHero post={post} />

        <article className={articleTypography}>
          <p>
            The best job I almost missed wasn&apos;t hidden behind a referral or buried in a Slack channel. It was on a
            company careers page—live for two days before it showed up on LinkedIn.
          </p>
          <p>I found it by accident, because I happened to be checking that one company&apos;s site for something else.</p>
          <p>By the time the LinkedIn post appeared, the applicant count was already climbing.</p>
          <p>
            That experience changed how I think about job search. The roles you want aren&apos;t always secret. They&apos;re
            just published somewhere most people don&apos;t look until later.
          </p>
          <p>Here&apos;s what I learned about finding jobs before they reach LinkedIn—and what actually works.</p>

          <h2>Why timing matters</h2>
          <p>
            Recruiters don&apos;t wait for a job to hit every board before they start reading applications. When a role
            goes live, applications begin arriving. Strong candidates get reviewed. Interviews get scheduled.
          </p>
          <p>
            By the time a listing reaches LinkedIn and hundreds of people apply in the same afternoon, the recruiter may
            already have a shortlist forming.
          </p>
          <p>
            You&apos;re not necessarily too late to get hired. But you are often too late to be first—and first is where
            visibility is highest.
          </p>
          <p>
            I broke down this pattern in{" "}
            <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false}>
              Why You&apos;re Probably Finding Jobs Too Late
            </Link>
            . The core idea is simple: jobs start on company career pages, then spread outward. The earlier you find them,
            the smaller the competition pool tends to be.
          </p>

          <h2>The problem with waiting for job boards</h2>
          <p>Job boards are built for reach, not timing.</p>
          <p>
            LinkedIn, Indeed, and similar platforms are excellent at putting the same listing in front of thousands of
            people at once. That&apos;s great for employers who want volume. It&apos;s rough for job seekers who want to
            stand out.
          </p>
          <p>
            When everyone discovers a role at the same moment, you&apos;re competing on the same resume, the same timing,
            the same crowded inbox on the recruiter&apos;s side.
          </p>
          <p>
            Waiting for boards also means you miss roles that never get syndicated at all—listings that live only on a
            company&apos;s own careers page. Those aren&apos;t rare edge cases. They show up more often than most people
            expect.
          </p>

          <h2>Greenhouse, Lever, Ashby, and Workday explained</h2>
          <p>
            If you&apos;ve applied to jobs online, you&apos;ve almost certainly used one of these systems—even if you
            didn&apos;t notice the name.
          </p>
          <p>
            <strong>Greenhouse</strong>, <strong>Lever</strong>, and <strong>Ashby</strong> are applicant tracking systems
            that power career pages for thousands of startups and mid-size companies. When a recruiter publishes a role,
            it typically appears on the company&apos;s careers site immediately.
          </p>
          <p>
            <strong>Workday</strong> is common at larger enterprises. Same idea, different scale—the careers section is
            tied to the company&apos;s internal HR stack.
          </p>
          <p>
            These aren&apos;t job boards. They&apos;re where jobs originate. LinkedIn and other aggregators often pull
            from them later—or don&apos;t pull at all.
          </p>
          <p>
            Once I understood that, checking career pages stopped feeling like extra homework and started feeling like
            checking the source.
          </p>

          <h2>How to monitor company career pages</h2>
          <p>If you want to find jobs early without a tool, here&apos;s the manual approach I tried first:</p>
          <ul>
            <li>Build a list of companies you&apos;d actually want to work for—not a list of every company you&apos;ve heard of.</li>
            <li>Bookmark each careers page. Greenhouse and Lever URLs often follow predictable patterns.</li>
            <li>Check them on a schedule—daily if you&apos;re searching seriously, a few times a week otherwise.</li>
            <li>When you see a role on LinkedIn, trace it back to the company site and compare posting dates if you can.</li>
            <li>Apply on the company site when the role is there, even if you found it on a board first.</li>
          </ul>
          <p>
            This works. It&apos;s also exhausting. Fifty companies means fifty tabs, fifty different page layouts, and a
            lot of time spent refreshing pages that haven&apos;t changed.
          </p>
          <p>
            For more on where to apply when a role exists in both places, read{" "}
            <Link href="/blog/company-career-sites-vs-linkedin" prefetch={false}>
              Company Career Sites vs LinkedIn: Where Should You Apply First?
            </Link>
            .
          </p>

          <BlogMidCta href="/jobs" label="Start Finding Jobs Earlier" article={SLUG} />

          <h2>Why most people don&apos;t do this manually</h2>
          <p>The logic is obvious. The execution is where it falls apart.</p>
          <p>
            Most job seekers are already juggling applications, tailoring resumes, preparing for interviews, and maybe
            working a current job. Adding a daily round of career-page checks doesn&apos;t fit cleanly into anyone&apos;s
            routine.
          </p>
          <p>
            It&apos;s also easy to forget. You check ten companies on Monday, get busy on Tuesday, and by Friday you&apos;re
            back to scrolling LinkedIn because it&apos;s one feed instead of forty bookmarks.
          </p>
          <p>
            I hit that wall myself. I knew career pages were the better source. I just couldn&apos;t keep up with them by
            hand—and I kept losing good roles anyway.
          </p>

          <h2>How JobLoom automates the process</h2>
          <p>
            JobLoom exists because manual monitoring doesn&apos;t scale—and because the information is already public on
            company career sites. Someone just needs to collect it consistently.
          </p>
          <p>
            JobLoom ingests roles from company career pages and ATS feeds as companies publish them, deduplicates listings
            across sources, and puts everything in one searchable{" "}
            <Link href="/jobs" prefetch={false}>
              jobs
            </Link>{" "}
            feed.
          </p>
          <p>
            You&apos;re not replacing LinkedIn entirely. You&apos;re adding an earlier layer—roles closer to when they
            went live, before the applicant count explodes on major boards.
          </p>
          <p>
            Resume-aware matching helps you decide which fresh listings are worth applying to, so you&apos;re not trading
            one overwhelming feed for another. See{" "}
            <Link href="/pricing" prefetch={false}>
              pricing
            </Link>{" "}
            for what&apos;s included on free vs Pro.
          </p>
          <p>You still apply on the employer&apos;s site. JobLoom handles discovery and triage—not submission.</p>

          <h2>Conclusion</h2>
          <p>Finding jobs before LinkedIn isn&apos;t about secret networks or insider tips.</p>
          <p>
            It&apos;s about looking where jobs actually get published first—and doing it consistently enough that you
            don&apos;t miss the window when competition is still manageable.
          </p>
          <p>
            You can do that manually with bookmarks and discipline. Or you can use a tool built for exactly this problem.
          </p>
          <p>
            Either way, the goal is the same: stop joining the queue after it&apos;s already formed. Show up earlier, apply
            with intention, and give yourself a real shot at being seen.
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
