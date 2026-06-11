import { permanentRedirect } from "next/navigation";
import { loadCompanySlugById } from "./companySlugById";
import {
  filtersToCompanyHubSearchParams,
  type JobFilters,
} from "./slug-parser";

/** Hub path for a resolved company slug; strips company scoping + pagination params. */
export function buildCompanyHubRedirectPath(
  slug: string,
  filters: JobFilters,
): string {
  const trimmedSlug = slug.trim();
  if (!trimmedSlug) return "/jobs";

  const {
    companyId: _companyId,
    page: _page,
    limit: _limit,
    offset: _offset,
    surface: _surface,
    ...hubFilters
  } = filters;

  const p = filtersToCompanyHubSearchParams(hubFilters);
  const qs = p.toString();
  return qs ? `/company/${trimmedSlug}?${qs}` : `/company/${trimmedSlug}`;
}

/**
 * When `filters.companyId` resolves to a company row, 308 to `/company/{slug}`.
 * Invalid / unknown ids fall through (no redirect).
 */
export async function redirectCompanyIdToHubIfNeeded(filters: JobFilters): Promise<void> {
  const companyId = filters.companyId?.trim();
  if (!companyId) return;

  const slug = await loadCompanySlugById(companyId);
  if (!slug) return;

  permanentRedirect(buildCompanyHubRedirectPath(slug, filters));
}
