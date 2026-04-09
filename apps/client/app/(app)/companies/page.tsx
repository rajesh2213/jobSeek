import type { Metadata } from "next";
import Link from "next/link";
import { fetchCompanies } from "../../../lib/api";
import { Container } from "../../../components/ui/Container";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";

export const metadata: Metadata = {
  title: "Companies | JobSeek",
  description: "Browse employers and explore their open roles.",
};

interface Props {
  searchParams: Promise<{ page?: string; q?: string }>;
}

export default async function CompaniesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";
  const { data: companies, meta } = await fetchCompanies({
    page,
    limit: 20,
    q: q || undefined,
  });

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams();
    if (p > 1) params.set("page", String(p));
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    return qs ? `/companies?${qs}` : "/companies";
  };

  return (
    <main className="min-h-screen">
      <Container width="wide" className="py-8">
        <h1 className="font-display text-3xl font-normal italic text-ink">Companies</h1>
        <p className="mt-1 text-sm text-ink-muted">Find an employer and explore canonical job listings.</p>

        <form
          action="/companies"
          method="get"
          className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-ink/10 bg-surface p-4 shadow-card"
        >
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5 text-sm">
            <span className="font-semibold text-ink">Search by name</span>
            <Input type="search" name="q" defaultValue={q} placeholder="e.g. Tesla" />
          </label>
          <Button variant="primary" size="md" type="submit">
            Search
          </Button>
        </form>

        {companies.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-surface px-6 py-12 text-center text-sm text-ink-muted">
            No companies match your search.
          </p>
        ) : (
          <ul className="mt-6 flex list-none flex-col gap-3 p-0">
            {companies.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/company/${c.slug}`}
                  className="block rounded-2xl border border-ink/10 bg-surface p-4 shadow-card transition-all duration-300 hover:border-teal/30 hover:shadow-card-hover"
                >
                  <strong className="text-ink">{c.name}</strong>
                  <p className="mt-1 text-sm text-ink-muted">{c.domain}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {meta && meta.totalPages > 1 && (
          <nav className="mt-8 flex flex-wrap items-center gap-2 text-sm" aria-label="Pagination">
            {page > 1 && (
              <Link
                href={buildPageHref(page - 1)}
                rel="prev"
                className="rounded-full border-2 border-ink/10 bg-surface px-4 py-2 font-medium text-ink no-underline transition-colors hover:border-teal hover:text-teal"
              >
                Previous
              </Link>
            )}
            <span className="text-ink-muted">
              Page {meta.page} of {meta.totalPages} ({meta.total} companies)
            </span>
            {page < meta.totalPages && (
              <Link
                href={buildPageHref(page + 1)}
                rel="next"
                className="rounded-full border-2 border-ink/10 bg-surface px-4 py-2 font-medium text-ink no-underline transition-colors hover:border-teal hover:text-teal"
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </Container>
    </main>
  );
}
