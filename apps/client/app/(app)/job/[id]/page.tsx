import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { isJobReady, type JobsApiResponse } from "../../../../lib/api";
import {
  getCompanyJobsUnified,
  listJobsUnified,
} from "../../../../lib/serverApi";
import { resolveJobDetail } from "../../../../lib/loadJobDetailSsr";
import { buildJobPostingJsonLd } from "../../../../lib/jobPostingJsonLd";
import { absoluteUrl } from "../../../../lib/seoSite";
import {
  refineSectionsForDisplay,
  resolveJobDetailSections,
  sectionsPlainTextForSeo,
} from "../../../../lib/resolveJobDetailSections";
import { rankSimilarJobs } from "../../../../lib/similarJobsRank";
import { filterSkillPillsForDisplay } from "../../../../lib/jobDisplay";
import { mergeBrowseSkillQueries, tokensFromRequirementLines } from "../../../../lib/seoSkillTokens";
import { Container } from "../../../../components/ui/Container";
import { Card } from "../../../../components/ui/Card";
import { JobHeader } from "../../../../components/job/JobHeader";
import { EnrichmentPills } from "../../../../components/job/EnrichmentPills";
import { JobDetailSeoPills } from "../../../../components/job/JobDetailSeoPills";
import { JobParsedContent } from "../../../../components/job/JobParsedContent";
import { CompanyCard } from "../../../../components/company/CompanyCard";
import { CompanyJobsPreview } from "../../../../components/company/CompanyJobsPreview";
import { SimilarJobsSection } from "../../../../components/job/SimilarJobsSection";
import { ResumeMatchSection } from "../../../../components/resume/ResumeMatchSection";
import { SeoFooterLinks } from "../../../../components/seo/SeoFooterLinks";
import { UserLocalResetCaption } from "../../../../components/job/UserLocalResetCaption";
import { EmailCaptureCard } from "../../../../components/email/EmailCaptureCard";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fetched = await resolveJobDetail(id, "metadata");
  if (!fetched) {
    return { title: "Job not found | JobLoom" };
  }
  const job = fetched.data;
  const sections = refineSectionsForDisplay(resolveJobDetailSections(job));
  const structured = sectionsPlainTextForSeo(sections);
  const desc =
    structured.slice(0, 160) ||
    job.description?.slice(0, 160) ||
    `View ${job.title} role details and apply.`;
  const canonical = absoluteUrl(`/job/${id}`);
  return {
    title: `${job.title} at ${job.company.name} | JobLoom`,
    description: desc,
    alternates: { canonical },
    openGraph: {
      title: `${job.title} at ${job.company.name}`,
      description: desc,
      url: canonical,
    },
  };
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const { getToken } = await auth();
  const token = await getToken();
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  const fetched = await resolveJobDetail(id, "page");
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

  const categoryForSimilar =
    typeof job.category === "string" && job.category.trim().length > 0
      ? job.category.trim()
      : null;

  const emptySimilar: JobsApiResponse = { data: [] };
  const [companyJobsRes, similarRes] = await Promise.all([
    getCompanyJobsUnified(job.company.slug, {
      limit: 5,
      token,
      forwardedFor,
      ssrPage: "job-detail",
    }),
    categoryForSimilar
      ? listJobsUnified(
          {
            category: categoryForSimilar,
            limit: 20,
          },
          {
            internalSeoSecret: process.env.INTERNAL_SEO_SECRET ?? null,
            forwardedFor,
            ssrPage: "job-detail-similar",
          },
        )
      : Promise.resolve(emptySimilar),
  ]);
  const companyJobs = (companyJobsRes.data ?? [])
    .filter((x) => x.id !== job.id && isJobReady(x))
    .slice(0, 3);
  const similarJobs = rankSimilarJobs(
    job,
    (similarRes.data ?? []).filter(isJobReady),
    6,
  );

  const applyHref = job.applyUrl?.trim() || job.sourceUrl?.trim() || "";
  const jsonLdDescription = structuredText || job.description || undefined;

  const jsonLd = buildJobPostingJsonLd(job, jsonLdDescription);

  return (
    <main className="min-h-screen">
      <Container width="wide" className="py-8">
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
            <CompanyJobsPreview companySlug={job.company.slug} jobs={companyJobs} />
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

        <SimilarJobsSection jobs={similarJobs} />
        <SeoFooterLinks browseSkills={browseFooterSkills} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </Container>
    </main>
  );
}
