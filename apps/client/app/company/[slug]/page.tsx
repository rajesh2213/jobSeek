import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCompanyBySlug, fetchCompanyJobs } from "../../../lib/api";
import { JobList } from "../../../components/job/JobList";
import { Container } from "../../../components/ui/Container";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const company = await fetchCompanyBySlug(slug);
  if (!company) {
    return { title: "Company not found | JobSeek" };
  }
  const title = `${company.name} Jobs | JobSeek`;
  const description = `Explore jobs at ${company.name}. Browse canonical listings and apply via the original posting.`;
  return { title, description, openGraph: { title, description } };
}

export default async function CompanyDetailPage({ params }: Props) {
  const { slug } = await params;
  const company = await fetchCompanyBySlug(slug);
  if (!company) notFound();

  const jobsResponse = await fetchCompanyJobs(slug, { page: 1, limit: 50 });

  return (
    <main className="min-h-screen">
      <Container width="wide" className="py-8">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-normal italic text-ink">{company.name}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            <span>Domain: {company.domain ?? "Pending enrichment"}</span>
            {company.careersUrl && (
              <>
                {" · "}
                <a
                  href={company.careersUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand no-underline hover:text-brand-hover"
                >
                  Careers site
                </a>
              </>
            )}
          </p>
        </header>

        <section>
          <h2 className="text-lg font-semibold text-ink">Open roles</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Showing canonical jobs only
            {jobsResponse.meta
              ? ` (${jobsResponse.meta.total} total${jobsResponse.meta.totalPages > 1 ? "; first page shown" : ""})`
              : ""}
            .
          </p>
          <div className="mt-4">
            <JobList jobs={jobsResponse.data} />
          </div>
          <p className="mt-6 text-sm">
            <Link href="/jobs" className="font-medium text-brand no-underline hover:text-brand-hover">
              ← Back to all jobs
            </Link>
          </p>
        </section>
      </Container>
    </main>
  );
}
