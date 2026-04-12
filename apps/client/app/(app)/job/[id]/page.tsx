import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { fetchCompanyJobs, fetchJobById, fetchJobs } from "../../../../lib/api";
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

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const job = await fetchJobById(id);
  if (!job) {
    return { title: "Job not found | JobSeek" };
  }
  const sections = refineSectionsForDisplay(resolveJobDetailSections(job));
  const structured = sectionsPlainTextForSeo(sections);
  const desc =
    structured.slice(0, 160) ||
    job.description?.slice(0, 160) ||
    `View ${job.title} role details and apply.`;
  return {
    title: `${job.title} at ${job.company.name} | JobSeek`,
    description: desc,
  };
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const job = await fetchJobById(id);
  if (!job || !job.company) notFound();

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

  const { getToken } = await auth();
  const token = await getToken();
  const [companyJobsRes, similarRes] = await Promise.all([
    fetchCompanyJobs(job.company.slug, { limit: 5 }),
    fetchJobs(
      {
        category: job.category,
        limit: 100,
      },
      { token },
    ),
  ]);
  const companyJobs = (companyJobsRes.data ?? []).filter((x) => x.id !== job.id).slice(0, 3);
  const similarJobs = rankSimilarJobs(job, similarRes.data ?? [], 6);

  const applyHref = job.applyUrl?.trim() || job.sourceUrl;
  const jsonLdDescription = structuredText || job.description || undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    hiringOrganization: {
      "@type": "Organization",
      name: job.company.name,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: job.country,
      },
    },
    datePosted: job.postedAt ?? undefined,
    description: jsonLdDescription,
  };

  return (
    <main className="min-h-screen">
      <Container width="wide" className="py-8">
        <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card accent="brand" as="article" className="space-y-6 px-6 py-8 text-left sm:px-8">
              <JobHeader job={job} applyHref={applyHref} />
              <ResumeMatchSection job={job} />
              <div className="w-full min-w-0 max-w-full space-y-0">
                <EnrichmentPills job={job} />
                <JobDetailSeoPills job={job} />
              </div>
              <div className="pt-2">
                <JobParsedContent sections={sections} />
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
          </aside>
        </div>

        <SimilarJobsSection jobs={similarJobs} />
        <SeoFooterLinks browseSkills={browseFooterSkills} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </Container>
    </main>
  );
}
