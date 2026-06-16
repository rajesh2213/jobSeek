import type { Metadata } from "next";
import Link from "next/link";
import { BlogPosthogTracker } from "../../../../components/analytics/BlogPosthogTracker";
import { BlogArticleShell } from "../../../../components/marketing/blog/BlogArticleShell";
import { BlogAuthor } from "../../../../components/marketing/blog/BlogAuthor";
import { BlogEndCta } from "../../../../components/marketing/blog/BlogEndCta";
import { BlogHero } from "../../../../components/marketing/blog/BlogHero";
import { BlogRelatedReading } from "../../../../components/marketing/blog/BlogRelatedReading";
import { JsonLdScript } from "../../../../components/seo/JsonLdScript";
import { buildBlogArticleMetadata } from "../../../../lib/blog/blogPageMetadata";
import { buildArticleJsonLd, buildBlogBreadcrumbJsonLd } from "../../../../lib/blog/blogSeo";
import { blogPostPath, getBlogPost, getRelatedPosts, type BlogPostMeta } from "../../../../lib/blog/posts";

const SLUG = "company-career-sites-vs-linkedin";

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

export default function CompanyCareerSitesVsLinkedInPage() {
  return (
    <>
      <BlogPosthogTracker article={SLUG} />
      <JsonLdScript data={articleJsonLd} />
      <JsonLdScript data={breadcrumbJsonLd} />
      <BlogArticleShell>
        <BlogHero post={post} />

        <article className={articleTypography}>
          <p>
            When I was job searching seriously, I had a default workflow: open LinkedIn, filter by role and location,
            scroll until something looked promising, apply.
          </p>
          <p>It felt responsible. LinkedIn is where everyone looks. It has social proof, applicant counts, company pages.</p>
          <p>But I kept running into the same wall.</p>
          <p>
            Roles that had been posted for a few hours already had hundreds of applicants. And the more I dug into how
            hiring actually works, the more I realized I was often applying in the wrong place—not wrong company, wrong
            channel.
          </p>
          <p>
            The question isn&apos;t really &quot;LinkedIn or career site?&quot; It&apos;s &quot;where did this job show up
            first, and where am I competing against the fewest people?&quot;
          </p>

          <h2>Why most job seekers start on LinkedIn</h2>
          <p>LinkedIn is convenient. One login, one feed, one apply button on a lot of listings.</p>
          <p>
            It also feels complete. If a job is on LinkedIn, it must be real, right? And you can see how many people have
            already applied, which is either motivating or demoralizing depending on the number.
          </p>
          <p>
            For recruiters, LinkedIn is a distribution channel. Post the role, reach a huge audience fast, fill the
            pipeline. For job seekers, it&apos;s the obvious starting point.
          </p>
          <p>
            I don&apos;t think that instinct is wrong. LinkedIn is useful. The problem is treating it as the only place
            jobs exist—or the first place they exist.
          </p>

          <h2>Where company career sites have an advantage</h2>
          <p>
            When a company opens a role, the listing usually lives on their careers page first. That page is often powered
            by an applicant tracking system—Greenhouse, Lever, Ashby, Workday, and others.
          </p>
          <p>
            The recruiter publishes the job internally, it goes live on the company site, and only then does it get
            syndicated outward to LinkedIn, Indeed, and other aggregators.
          </p>
          <p>That gap might be a few hours. Sometimes a few days.</p>
          <p>
            During that window, the applicant pool is smaller. Recruiters often start reviewing applications as they arrive.
            You&apos;re not competing against everyone who will eventually see the LinkedIn post—you&apos;re competing
            against whoever found the role on the company site.
          </p>
          <p>
            I wrote about this timing pattern in{" "}
            <Link href="/blog/why-youre-probably-finding-jobs-too-late" prefetch={false}>
              Why You&apos;re Probably Finding Jobs Too Late
            </Link>
            . The short version: early visibility beats late volume almost every time.
          </p>

          <h2>Why some jobs never reach job boards</h2>
          <p>Not every role gets pushed to LinkedIn.</p>
          <p>
            Some companies only post on their own careers page, especially for specialized or senior roles. Others syndicate
            selectively—maybe one board but not another. Referral-heavy companies sometimes keep listings low-profile on
            purpose.
          </p>
          <p>
            If you only search job boards, you miss those roles entirely. They were never hidden. You just weren&apos;t
            looking where they were published.
          </p>
          <p>
            That&apos;s one reason I started paying attention to company career pages directly, not just the boards that
            repost them later.
          </p>

          <h2>Should you stop using LinkedIn?</h2>
          <p>No—and I don&apos;t think you should.</p>
          <p>
            LinkedIn is still where a lot of legitimate jobs appear. It&apos;s good for discovery, company research, and
            understanding what&apos;s open in your market. Some listings only exist there because the employer chose that
            channel.
          </p>
          <p>
            The mistake is assuming LinkedIn is always first. Or that applying on LinkedIn is the same as applying on the
            company site. Often it isn&apos;t—you might get redirected anyway, but you&apos;ve already lost time and
            joined a bigger queue.
          </p>
          <p>
            When a role exists on both, I&apos;d rather apply through the company&apos;s own careers page if I can find it.
            Same job, fewer strangers ahead of me in line.
          </p>

          <h2>The best approach: use both</h2>
          <p>What worked for me was a simple split:</p>
          <ul>
            <li>Use LinkedIn (and other boards) for market scanning—what&apos;s hiring, what titles are in demand, salary signals.</li>
            <li>
              Use company career sites for applications when the role is fresh—or when you find it there first before it
              hits a board.
            </li>
            <li>
              When you see something on LinkedIn, check whether it&apos;s also on the company site and how long it&apos;s
              been up in each place.
            </li>
          </ul>
          <p>
            That last step sounds tedious. It is, if you do it by hand for every listing. But the payoff is real: you apply
            earlier, with less noise, and you catch roles that never leave the company site at all.
          </p>
          <p>
            For a deeper walkthrough on monitoring career pages yourself, see{" "}
            <Link href="/blog/how-to-find-jobs-before-linkedin" prefetch={false}>
              How to Find Jobs Before They Reach LinkedIn
            </Link>
            .
          </p>

          <h2>How JobLoom helps</h2>
          <p>
            I built JobLoom because manually checking dozens of company career pages every day wasn&apos;t sustainable—and
            I kept missing good roles anyway.
          </p>
          <p>
            JobLoom monitors company career sites and ATS feeds, then surfaces those listings in one searchable{" "}
            <Link href="/jobs" prefetch={false}>
              jobs
            </Link>{" "}
            feed. The goal isn&apos;t to replace LinkedIn. It&apos;s to show you what appeared on career pages before—or
            without—hitting major boards.
          </p>
          <p>
            You still apply on the employer&apos;s site. JobLoom helps you find the role sooner and decide if it&apos;s
            worth your time—with resume-aware matching on{" "}
            <Link href="/pricing" prefetch={false}>
              Pro plans
            </Link>{" "}
            so you&apos;re not applying blindly to everything in your feed.
          </p>

          <h2>Conclusion</h2>
          <p>Company career sites and LinkedIn aren&apos;t enemies. They&apos;re different layers of the same hiring process.</p>
          <p>
            LinkedIn is where a lot of people discover jobs. Company career sites are where many of those jobs actually
            start—and where the competition is often lighter if you get there early.
          </p>
          <p>
            If you&apos;ve been applying on boards and wondering why perfect-looking roles already feel crowded, try shifting
            some of your energy upstream. Check the company site. Browse fresh listings closer to the source.
          </p>
          <p>That&apos;s the edge JobLoom is built around—and it&apos;s the one I wish I&apos;d had sooner.</p>
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
