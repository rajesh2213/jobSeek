import { cache } from "react";
import { getCompanyBySlugUnified } from "./serverApi";

function logCompanyDedupe(payload: Record<string, unknown>): void {
  if (process.env.DEBUG_SSR_DEDUPE !== "1") return;
  console.info(JSON.stringify(payload));
}

/**
 * Dedupes duplicate metadata + page work inside one SSR/RSC tree (`React.cache` is per-request,
 * not cross-request — does not reduce traffic volume across navigations).
 */
export const loadCompanyDetailCached = cache(async (slug: string) => {
  const company = await getCompanyBySlugUnified(slug);
  logCompanyDedupe({
    event: "company_detail_dedupe_check",
    phase: "fetch_completed",
    slug,
  });
  return company;
});

export async function resolveCompanyDetail(slug: string, calledFrom: "metadata" | "page") {
  logCompanyDedupe({
    event: "company_detail_dedupe_check",
    calledFrom,
  });
  return loadCompanyDetailCached(slug);
}
