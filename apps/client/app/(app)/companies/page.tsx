import type { Metadata } from "next";
import {
  fetchCompanies,
  type CompaniesSort,
} from "../../../lib/api";
import { CompaniesSearchPage } from "../../../components/companies/CompaniesSearchPage";

export const metadata: Metadata = {
  title: "Companies | JobLoom",
  description:
    "Browse employers hiring now: tech companies careers, remote companies hiring, and startup jobs. Explore open roles and apply early.",
};

function spFirst(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CompaniesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(spFirst(sp.page) ?? "1", 10) || 1);
  const q = spFirst(sp.q) ?? "";
  const sortRaw = spFirst(sp.sort);
  const sort: CompaniesSort =
    sortRaw === "recent" || sortRaw === "name" ? sortRaw : "jobs";
  const hiring =
    spFirst(sp.hiring) === "true" || spFirst(sp.hiring) === "1";
  const remote =
    spFirst(sp.remote) === "true" || spFirst(sp.remote) === "1";

  const { data: companies, meta } = await fetchCompanies({
    page,
    limit: 24,
    q: q || undefined,
    sort,
    hiring: hiring || undefined,
    remote: remote || undefined,
  });

  return (
    <CompaniesSearchPage initialCompanies={companies} initialMeta={meta} />
  );
}
