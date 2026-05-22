import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadJobDetailPage } from "../../../../lib/jobsPageData";
import {
  buildJobPostingJsonLd,
  shouldEmitJobPostingJsonLd,
} from "../../../../lib/jobPostingJsonLd";
import { absoluteUrl } from "../../../../lib/seoSite";
import {
  refineSectionsForDisplay,
  resolveJobDetailSections,
  sectionsPlainTextForSeo,
} from "../../../../lib/resolveJobDetailSections";
import { filterSkillPillsForDisplay, jobDetailPinLocationText } from "../../../../lib/jobDisplay";
import { mergeBrowseSkillQueries, tokensFromRequirementLines } from "../../../../lib/seoSkillTokens";
import { Container } from "../../../../components/ui/Container";
import { Card } from "../../../../components/ui/Card";
import { JobHeader } from "../../../../components/job/JobHeader";
import { EnrichmentPills } from "../../../../components/job/EnrichmentPills";
import { JobDetailSeoPills } from "../../../../components/job/JobDetailSeoPills";
import { JobParsedContent } from "../../../../components/job/JobParsedContent";
import { CompanyCard } from "../../../../components/company/CompanyCard";
import {
  CompanyJobsPreviewDeferred,
  SimilarJobsDeferred,
} from "../../../../components/job/JobDetailDeferredSections";
import { ResumeMatchSection } from "../../../../components/resume/ResumeMatchSection";
import { SeoFooterLinks } from "../../../../components/seo/SeoFooterLinks";
import { SeoBreadcrumbs } from "../../../../components/seo/SeoBreadcrumbs";
import { UserLocalResetCaption } from "../../../../components/job/UserLocalResetCaption";
import { EmailCaptureCard } from "../../../../components/email/EmailCaptureCard";
import { JobDetailPosthogTracker } from "../../../../components/analytics/JobDetailPosthogTracker";
import { buildJobDetailSeo } from "../../../../lib/seoJobDetail";

/** Anonymous crawlers and repeat views share ISR; authenticated path stays dynamic via loader. */
export const revalidate = 300;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fetched = await loadJobDetailPage(id);
  if (!fetched) {
    return { title: "Job not found | JobLoom" };
  }
  const job = fetched.data;
  const sections = refineSectionsForDisplay(resolveJobDetailSections(job));
  const structured = sectionsPlainTextForSeo(sections);
  const { title, description } = buildJobDetailSeo(job, {
    plainDescriptionForSeo: structured,
  });
  const canonical = absoluteUrl(`/job/${id}`);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const fetched = await loadJobDetailPage(id);
  if (!fetched?.data?.company) notFound();

  const job = fetched.data;
  const detailCap = fetched.meta;
  const nearLimitWarning = Boolean(detailCap?.limit?.warning);
  const capReached = Boolean(detailCap?.capReached);

  const sections = refineSectionsForDisplay(resolveJobDetailSections(job));
  const structuredText = sectionsPlainTextForSeo(sections);

  const browseFooterSkills = mergeBrowseSkillQueries(
    filterSkillPillsForDisplay([
      ...job.skills,
      ...tokensFromRequirementLines(sections.requirement),
    ]),
    [],
    10,
  );

  const applyHref = job.applyUrl?.trim() || job.sourceUrl?.trim() || "";
  const jsonLdDescription =
    structuredText || job.description || job.structuredDataDescription || undefined;

  const emitJobPostingLd = shouldEmitJobPostingJsonLd(job, jsonLdDescription);
  const jsonLd = emitJobPostingLd ? buildJobPostingJsonLd(job, jsonLdDescription) : null;

  return (
    <main className="min-h-screen">
      <JobDetailPosthogTracker
        jobId={job.id}
        company={job.company.name}
        location={jobDetailPinLocationText(job)}
        remote={Boolean(job.isRemote || job.enriched?.remote)}
        source="job_detail_page"
      />
      <Container width="wide" className="py-8">
        <SeoBreadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Jobs", href: "/jobs" },
            { name: job.title },
          ]}
        />
        <section className="mb-3 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-xs leading-snug text-ink/75 sm:mb-4 sm:px-4 sm:py-3 sm:text-sm sm:leading-normal">
          <p>
            <Link href="/" className="font-semibold text-brand hover:underline">
              JobLoom
            </Link>{" "}
            finds jobs directly from company career sites before many job boards, then routes you into detailed role pages like this one.
          </p>
        </section>
        <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card accent="brand" as="article" className="space-y-6 px-6 py-8 text-left sm:px-8">
              <JobHeader
                job={job}
                applyHref={applyHref}
                applyUrlLocked={capReached}
              />
              <ResumeMatchSection job={job} />
              {nearLimitWarning ? (
                <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-ink">
                  You are nearing today&apos;s limit. Upgrade for unlimited access.
                </div>
              ) : null}
              <div className="w-full min-w-0 max-w-full space-y-0">
                <EnrichmentPills job={job} />
                <JobDetailSeoPills job={job} />
              </div>
              <div className="pt-2">
                {capReached ? (
                  <div
                    className="rounded-2xl border border-brand/25 bg-brand/5 px-5 py-6 text-center"
                    role="region"
                    aria-label="Browse limit"
                  >
                    <p className="text-sm font-semibold text-ink">
                      You&apos;ve reached today&apos;s free browse limit.
                    </p>
                    <p className="mt-1 text-sm text-ink/70">
                      Upgrade to read the full description and apply to this role.
                    </p>
                    <Link
                      href="/pricing"
                      className="mt-4 inline-block text-sm font-semibold text-brand underline underline-offset-2 hover:text-brand-hover"
                    >
                      View Pro plans
                    </Link>
                    {detailCap?.resetAt ? (
                      <UserLocalResetCaption
                        iso={detailCap.resetAt}
                        className="mt-3 text-xs text-ink/50"
                        muted
                      />
                    ) : null}
                  </div>
                ) : (
                  <JobParsedContent sections={sections} />
                )}
              </div>
              {process.env.NODE_ENV === "development" ? (
                <details className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left">
                  <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    Debug: parsedDescription (dev only)
                  </summary>
                  <pre className="mt-2 max-h-[min(480px,50vh)] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink/80">
                    {JSON.stringify(job.parsedDescription ?? null, null, 2)}
                  </pre>
                </details>
              ) : null}
            </Card>
          </div>
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <CompanyCard company={job.company} />
            <CompanyJobsPreviewDeferred job={job} />
            <EmailCaptureCard
              source="job_page"
              title="Get similar jobs in your inbox"
              subtitle="Stay ahead with related opportunities and fresh openings."
              context={{
                role: job.role,
                location: job.locationCountry ?? undefined,
                jobId: job.id,
              }}
            />
          </aside>
        </div>

        <SimilarJobsDeferred job={job} />
        <SeoFooterLinks browseSkills={browseFooterSkills} />
        {jsonLd ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        ) : null}
      </Container>
    </main>
  );
}
