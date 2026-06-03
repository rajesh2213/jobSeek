import { Suspense } from "react";
import type { CompanyListItem } from "../../lib/api";
import { CompaniesSearchClient } from "./CompaniesSearchClient";
import { CompaniesShellSkeleton } from "./CompaniesShellSkeleton";

interface Props {
  initialCompanies: CompanyListItem[];
  initialMeta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore?: boolean;
    stats?: {
      totalTracked: number;
      hiringThisWeek: number;
      activeHiringCompanies: number;
    };
  };
}

export function CompaniesSearchPage({ initialCompanies, initialMeta }: Props) {
  return (
    <Suspense fallback={<CompaniesShellSkeleton />}>
      <CompaniesSearchClient
        initialCompanies={initialCompanies}
        initialMeta={initialMeta}
      />
    </Suspense>
  );
}
