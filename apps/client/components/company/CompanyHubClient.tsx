"use client";

import { useInView } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  fetchCompanies,
  fetchCompanyBySlug,
  fetchCompanyJobs,
  isJobReady,
  type CompanyDetail,
  type CompanyListItem,
  type JobItem,
  type JobsApiResponse,
} from "../../lib/api";
import { accentFromId } from "../../lib/accent";
import { cn } from "../../lib/cn";
import { signalProgrammaticNavigation } from "../layout/RouteLoader";
import {
  filtersToCompanyHubSearchParams,
  hasActiveJobFilters,
  parseJobFiltersFromSearch,
  type JobFilters,
} from "../../lib/slug-parser";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { FREE_DISCOVERY_PREVIEW_JOB_ROWS } from "../../lib/planLimits";
import { Badge } from "../ui/Badge";
import { Button, buttonClassName } from "../ui/Button";
import { JobCard } from "../job/JobCard";
import { CompanyHubJobsListSkeleton, CompanyHubSkeleton } from "./CompanyHubSkeleton";

const LimitWallEnhanced = dynamic(
  () => import("../job/LimitWallEnhanced").then((m) => m.LimitWallEnhanced),
  { ssr: true },
);

const HubJobCard = memo(JobCard);
HubJobCard.displayName = "HubJobCard";

const DEFAULT_LIMIT = 20;

function websiteUrlFromDomain(domain: string): string {
  const d = domain.trim();
  if (!d) return "#";
  const lower = d.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return d;
  return `https://${d}`;
}

function clearbitFromDomain(domain: string | null): string | null {
  const d = domain?.trim();
  if (!d) return null;
  return `https://logo.clearbit.com/${encodeURIComponent(d)}`;
}

function hubFiltersFromSearchParams(sp: URLSearchParams): Omit<JobFilters, "companyId"> {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    raw[k] = v;
  });
  const f = parseJobFiltersFromSearch(raw);
  const { companyId: _c, ...rest } = f;
  return rest;
}

function resolveOpenRoleCount(input: {
  listMeta: NonNullable<JobsApiResponse["meta"]>;
  company: CompanyDetail | null;
  listJobs: JobItem[];
  jobsListLoading: boolean;
}): number | null {
  const metaTotal =
    typeof input.listMeta.total === "number"
      ? input.listMeta.total
      : typeof input.listMeta.totalCount === "number"
        ? input.listMeta.totalCount
        : null;
  if (typeof metaTotal === "number" && metaTotal > 0) return metaTotal;
  if (typeof input.company?.visibleJobCount === "number" && input.company.visibleJobCount > 0) {
    return input.company.visibleJobCount;
  }
  if (typeof input.company?.jobCount === "number" && input.company.jobCount > 0) {
    return input.company.jobCount;
  }
  if (input.jobsListLoading) return null;
  if (typeof metaTotal === "number") return metaTotal;
  if (input.listJobs.length > 0) return input.listJobs.length;
  return 0;
}

function formatOpenRolesLabel(count: number | null): string | null {
  if (count == null) return null;
  return count === 1 ? "1 open role" : `${count} open roles`;
}

function buildCompanyHubPath(
  slug: string,
  filters: Omit<JobFilters, "companyId">,
): string {
  const p = filtersToCompanyHubSearchParams({
    ...filters,
    page: undefined,
    limit: undefined,
    offset: undefined,
  });
  const qs = p.toString();
  return qs ? `/company/${slug}?${qs}` : `/company/${slug}`;
}

/** Sort + work-type chips on the company hub are Pro-only; other query params (e.g. role) stay. */
function hasProOnlyHubFilters(f: Omit<JobFilters, "companyId">): boolean {
  if (f.sort === "salary_desc") return true;
  if (Array.isArray(f.workTypes) && f.workTypes.length > 0) return true;
  if (f.workType != null) return true;
  if (f.isRemote === true) return true;
  return false;
}

function stripProOnlyHubFilters(
  f: Omit<JobFilters, "companyId">,
): Omit<JobFilters, "companyId"> {
  const out: Omit<JobFilters, "companyId"> = { ...f };
  if (out.sort === "salary_desc") delete out.sort;
  delete out.workTypes;
  delete out.workType;
  delete out.isRemote;
  return out;
}

interface Props {
  company: CompanyDetail | null;
  slug: string;
  initialJobs: JobItem[];
  initialMeta: NonNullable<JobsApiResponse["meta"]>;
  relatedCompanies: CompanyListItem[];
}

export function CompanyHubClient({
  company: initialCompany,
  slug,
  initialJobs,
  initialMeta,
  relatedCompanies,
}: Props) {
  const { getToken } = useAuth();
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [resolvedCompany, setResolvedCompany] = useState<CompanyDetail | null>(initialCompany);
  const [companyHydrating, setCompanyHydrating] = useState(!initialCompany);
  const [companyMissing, setCompanyMissing] = useState(false);
  const urlKey = searchParams.toString();
  const urlFilters = useMemo(
    () => hubFiltersFromSearchParams(new URLSearchParams(urlKey)),
    [urlKey],
  );

  const [listJobs, setListJobs] = useState<JobItem[]>(() => initialJobs.filter(isJobReady));
  const [listMeta, setListMeta] = useState(initialMeta);
  const [relatedCompaniesState, setRelatedCompaniesState] = useState<CompanyListItem[]>(
    relatedCompanies,
  );
  const [jobsListLoading, setJobsListLoading] = useState(
    () => initialJobs.filter(isJobReady).length === 0,
  );
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setResolvedCompany(initialCompany);
    setCompanyMissing(false);
    setCompanyHydrating(!initialCompany);
  }, [initialCompany]);

  useEffect(() => {
    if (resolvedCompany) {
      setCompanyHydrating(false);
      return;
    }
    let cancelled = false;
    setCompanyHydrating(true);
    void (async () => {
      try {
        const next = await fetchCompanyBySlug(slug);
        if (cancelled) return;
        if (!next) {
          setCompanyMissing(true);
        } else {
          setResolvedCompany(next);
        }
      } catch {
        if (!cancelled) setCompanyMissing(true);
      } finally {
        if (!cancelled) setCompanyHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, resolvedCompany]);

  useEffect(() => {
    setListJobs(initialJobs.filter(isJobReady));
    setListMeta(initialMeta);
  }, [initialJobs, initialMeta]);

  useEffect(() => {
    setRelatedCompaniesState(relatedCompanies);
  }, [relatedCompanies]);

  const navigateHub = useCallback(
    (next: Omit<JobFilters, "companyId">) => {
      const href = buildCompanyHubPath(slug, next);
      signalProgrammaticNavigation(href);
      router.push(href);
    },
    [router, slug],
  );

  const totalRoles = useMemo(
    () =>
      resolveOpenRoleCount({
        listMeta,
        company: resolvedCompany,
        listJobs,
        jobsListLoading,
      }),
    [listMeta, resolvedCompany, listJobs, jobsListLoading],
  );
  const openRolesLabel = formatOpenRolesLabel(totalRoles);
  const showJobsSkeleton = jobsListLoading && listJobs.length === 0;
  const canLoadMore =
    Boolean(listMeta) &&
    (listMeta.hasMore === true ||
      (listMeta.totalPages != null && listMeta.page < listMeta.totalPages));

  const filterBase = useMemo(() => {
    const { page: _p, limit: _l, offset: _o, ...rest } = urlFilters;
    return rest;
  }, [urlFilters]);

  useEffect(() => {
    let cancelled = false;
    const { page: _p, limit: _l, offset: _o, ...filterRest } = urlFilters;
    const page = Math.max(1, urlFilters.page ?? 1);
    const limit =
      typeof urlFilters.limit === "number" && urlFilters.limit > 0
        ? urlFilters.limit
        : DEFAULT_LIMIT;
    void (async () => {
      if (listJobs.length === 0) setJobsListLoading(true);
      try {
        const token = await getToken();
        const [jobsRes, companiesRes] = await Promise.all([
          fetchCompanyJobs(slug, {
            page,
            limit,
            filters: {
              ...filterRest,
              page: undefined,
              limit: undefined,
              offset: undefined,
            },
            token,
          }),
          fetchCompanies({ limit: 12, sort: "jobs" }),
        ]);
        if (cancelled) return;
        setListJobs((jobsRes.data ?? []).filter(isJobReady));
        if (jobsRes.meta) setListMeta(jobsRes.meta);
        setRelatedCompaniesState(
          companiesRes.data.filter((c) => c.slug !== slug).slice(0, 6),
        );
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setJobsListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, slug, urlKey, urlFilters]);

  const onLoadMore = useCallback(async () => {
    if (!canLoadMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      const nextPage = listMeta.page + 1;
      const res = await fetchCompanyJobs(slug, {
        page: nextPage,
        limit: listMeta.pageSize || DEFAULT_LIMIT,
        filters: {
          ...filterBase,
          page: undefined,
          limit: undefined,
          offset: undefined,
        },
        token,
      });
      setListJobs((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        const merged = [...prev];
        for (const j of res.data) {
          if (!isJobReady(j)) continue;
          if (!seen.has(j.id)) {
            seen.add(j.id);
            merged.push(j);
          }
        }
        return merged;
      });
      if (res.meta) setListMeta(res.meta);
    } finally {
      setLoadingMore(false);
    }
  }, [canLoadMore, loadingMore, listMeta, slug, filterBase, getToken]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sentinelRef, { amount: 0, margin: "200px" });
  useEffect(() => {
    if (inView && canLoadMore && !loadingMore) void onLoadMore();
  }, [inView, canLoadMore, loadingMore, onLoadMore]);

  const sortValue = urlFilters.sort === "salary_desc" ? "salary_desc" : "latest";

  const toggleWorkType = (w: "remote" | "onsite" | "hybrid") => {
    const cur = { ...urlFilters };
    if (cur.workTypes?.length === 1 && cur.workTypes[0] === w) {
      const { workTypes, isRemote, workType, ...rest } = cur;
      navigateHub(rest);
      return;
    }
    navigateHub({
      ...cur,
      workTypes: [w],
      isRemote: w === "remote" ? true : undefined,
      workType: w === "remote" ? "remote" : undefined,
    });
  };

  const activeWorkType =
    urlFilters.workTypes?.length === 1 ? urlFilters.workTypes[0] : null;

  const filtersActive = hasActiveJobFilters({
    ...urlFilters,
    companyId: undefined,
    page: undefined,
    limit: undefined,
    offset: undefined,
  });

  /** Free tier: strip Pro-only hub params and refetch so the list matches the cleaned URL. */
  useEffect(() => {
    if (!planLoaded || isPro) return;
    if (!hasProOnlyHubFilters(urlFilters)) return;
    let cancelled = false;
    const cleaned = stripProOnlyHubFilters(urlFilters);
    void (async () => {
      setJobsListLoading(true);
      try {
        router.replace(buildCompanyHubPath(slug, cleaned));
        const token = await getToken();
        const { page: _p, limit: _l, offset: _o, ...filterRest } = cleaned;
        const res = await fetchCompanyJobs(slug, {
          page: 1,
          limit: DEFAULT_LIMIT,
          filters: {
            ...filterRest,
            page: undefined,
            limit: undefined,
            offset: undefined,
          },
          token,
        });
        if (cancelled) return;
        setListJobs(res.data);
        if (res.meta) setListMeta(res.meta);
      } finally {
        if (!cancelled) setJobsListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planLoaded, isPro, slug, urlFilters, router, getToken]);

  const emptyFiltered =
    !showJobsSkeleton &&
    listJobs.length === 0 &&
    (totalRoles ?? 0) === 0 &&
    filtersActive;

  const emptyNoRoles =
    !showJobsSkeleton &&
    listJobs.length === 0 &&
    (totalRoles ?? 0) === 0 &&
    !filtersActive;

  const jobsLinkAll = `/company/${slug}`;

  const jobsLinkEngineering = buildCompanyHubPath(slug, { role: "engineering" });
  const jobsLinkReact = buildCompanyHubPath(slug, { skills: ["react"] });

  if (companyHydrating) {
    return <CompanyHubSkeleton />;
  }

  if (!resolvedCompany || companyMissing) {
    return (
      <main className="min-h-screen px-6 py-16">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-extrabold text-ink">Company not found</h1>
          <p className="mt-2 text-sm text-ink/70">
            This employer page is unavailable or the link may be outdated.
          </p>
          <Link
            href="/companies"
            className="mt-6 inline-flex text-sm font-semibold text-brand hover:underline"
          >
            Browse companies
          </Link>
        </div>
      </main>
    );
  }

  const company = resolvedCompany;

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 border-b border-ink/10 bg-canvas/95 px-4 py-2 backdrop-blur-md sm:px-6 lg:hidden">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3">
          <CompanyHubLogo
            companyId={company.id}
            domain={company.domain}
            logoUrl={company.logoUrl}
            name={company.name}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{company.name}</p>
            <p className="text-xs text-ink/50">
              {openRolesLabel ?? "Open roles"}
            </p>
          </div>
          <Link
            href="#company-jobs"
            className="shrink-0 text-xs font-semibold text-brand no-underline"
          >
            Roles
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <CompanyHubLogo
            companyId={company.id}
            domain={company.domain}
            logoUrl={company.logoUrl}
            name={company.name}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-ink">
              {openRolesLabel
                ? `${company.name} — ${openRolesLabel}`
                : company.name}
            </h1>
            <div className="mt-1 text-sm">
              {company.domain?.trim() ? (
                <a
                  href={websiteUrlFromDomain(company.domain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand no-underline hover:underline"
                >
                  {company.domain}
                </a>
              ) : (
                <span className="text-ink/50">Domain pending</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {openRolesLabel ? (
                <Badge tone="teal" caps={false}>
                  {openRolesLabel}
                </Badge>
              ) : null}
              {isPro && (totalRoles ?? 0) > 0 ? (
                <Badge tone="brand" caps={false}>
                  Hiring now
                </Badge>
              ) : null}
            </div>
          </div>
        </header>

        <p className="mt-3 text-ink/60">
          Explore all open roles from {company.name}.
        </p>

        {isPro ? (
          <div
            id="company-jobs"
            className={cn(
              "mt-6 flex flex-col gap-3 rounded-2xl border border-ink/10 bg-surface/80 p-4 shadow-card",
              "md:flex-row md:flex-wrap md:items-end md:gap-3",
            )}
          >
            <label className="flex flex-col gap-1.5 text-sm md:w-44 md:shrink-0">
              <span className="font-semibold leading-none text-ink">Sort</span>
              <select
                className={cn(
                  "w-full rounded-2xl border-0 bg-surface px-3.5 py-2.5 text-sm text-ink shadow-sm ring-1 ring-ink/5",
                  "h-10 !py-0 leading-snug focus:outline-none focus:ring-2 focus:ring-brand/30",
                )}
                value={sortValue}
                onChange={(e) => {
                  const v = e.target.value;
                  navigateHub({
                    ...urlFilters,
                    sort: v === "salary_desc" ? "salary_desc" : undefined,
                  });
                }}
                aria-label="Sort jobs"
              >
                <option value="latest">Latest</option>
                <option value="salary_desc">Highest salary</option>
              </select>
            </label>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-sm font-semibold leading-none text-ink">Filters</span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["remote", "Remote"],
                    ["onsite", "On-site"],
                    ...(process.env.NEXT_PUBLIC_HYBRID_FILTER === "true"
                      ? ([["hybrid", "Hybrid"]] as const)
                      : []),
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleWorkType(key)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors",
                      activeWorkType === key
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-ink/15 bg-surface text-ink/75 ring-1 ring-ink/5 hover:border-ink/25",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div id="company-jobs" className="mt-6">
            <p className="text-sm text-ink/65">
              <Link href="/pricing?from=browse_nearing" className="font-semibold text-brand no-underline hover:underline">
                Upgrade to Pro
              </Link>{" "}
              to sort and filter roles by work type and salary.
            </p>
          </div>
        )}
        {!isPro && listMeta.limit?.warning ? (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-ink">
            You are nearing today&apos;s limit.{" "}
            <Link
              href="/pricing?from=browse_nearing"
              className="font-semibold text-brand no-underline hover:underline"
            >
              Upgrade for unlimited access
            </Link>
            .
          </div>
        ) : null}

        {showJobsSkeleton ? (
          <CompanyHubJobsListSkeleton count={5} />
        ) : emptyFiltered ? (
          <div
            className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-surface px-6 py-12 text-center"
            role="status"
          >
            <p className="font-medium text-ink">No roles match your filters</p>
            <p className="mt-2 text-sm text-ink-muted">
              Try removing filters or explore other companies.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigateHub({})}
              >
                Clear filters
              </Button>
              <Link
                href="/companies"
                className={buttonClassName({ variant: "primary", size: "sm" })}
              >
                Browse companies
              </Link>
            </div>
          </div>
        ) : emptyNoRoles ? (
          <p
            className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-surface px-6 py-12 text-center text-sm text-ink-muted"
            role="status"
          >
            No open roles listed for this company yet. Check back soon or browse all jobs.
          </p>
        ) : (
          <>
            {(() => {
              const capMode = listMeta.limit?.mode ?? "hard";
              const hardMode = capMode === "hard";
              const discoveryPhase = listMeta.discoveryPhase;
              const totalMatches = listMeta.total ?? totalRoles ?? 0;
              const showDiscoveryWall = Boolean(
                !isPro &&
                  hardMode &&
                  listMeta.viewCapUnlimited === false &&
                  listMeta.resetAt &&
                  listJobs.length > 0 &&
                  (discoveryPhase === "search" ||
                    discoveryPhase === "preview" ||
                    discoveryPhase === undefined),
              );
              const hiddenForWall =
                discoveryPhase === "preview"
                  ? Math.max(0, listMeta.totalHidden ?? 0)
                  : Math.max(0, totalMatches - listJobs.length);
              const jobsForList =
                hardMode && discoveryPhase === "preview"
                  ? listJobs.slice(0, FREE_DISCOVERY_PREVIEW_JOB_ROWS)
                  : listJobs;
              const wallPhase = discoveryPhase === "preview" ? "preview" : "search";
              return (
                <>
                  <section className="mt-8 flex flex-col gap-5" aria-label="Open roles">
                    {jobsForList.map((job) => (
                      <div
                        key={job.id}
                        className="transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <HubJobCard job={job} surface="company_hub" />
                      </div>
                    ))}
                  </section>
                  {showDiscoveryWall && listMeta.resetAt ? (
                    <LimitWallEnhanced
                      resetAt={listMeta.resetAt}
                      count={hiddenForWall}
                      previewJobs={jobsForList}
                      phase={wallPhase}
                    />
                  ) : null}
                </>
              );
            })()}

            {canLoadMore ? (
              <div ref={sentinelRef} className="mt-8 flex justify-center pb-4">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="w-full max-w-md"
                  disabled={loadingMore}
                  onClick={() => void onLoadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more roles"}
                </Button>
              </div>
            ) : null}
          </>
        )}

        {relatedCompaniesState.length > 0 ? (
          <section className="mt-12 border-t border-ink/10 pt-10">
            <h3 className="text-lg font-semibold text-ink">More companies hiring</h3>
            <p className="mt-1 text-sm text-ink/55">
              Other employers with active listings (by open role count).
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {relatedCompaniesState.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/company/${c.slug}`}
                    className="flex items-center gap-3 rounded-xl border border-ink/10 bg-surface p-3 no-underline transition-colors hover:border-brand/30"
                  >
                    <RelatedCompanyAvatar company={c} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{c.name}</p>
                      <p className="truncate text-xs text-ink/50">
                        {c.jobCount ?? 0} open roles
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12 border-t border-ink/10 pt-10">
          <h2 className="font-display text-xl font-normal italic text-ink">
            Jobs at {company.name}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/80">
            Explore verified job openings at {company.name}. Browse roles across
            engineering, product, and more. Apply early to increase your chances. See all
            listings in one place:{" "}
            <Link href={jobsLinkAll} className="font-medium text-brand no-underline hover:underline">
              jobs at this company
            </Link>
            , narrow to{" "}
            <Link
              href={jobsLinkEngineering}
              className="font-medium text-brand no-underline hover:underline"
            >
              engineering
            </Link>{" "}
            or{" "}
            <Link
              href={jobsLinkReact}
              className="font-medium text-brand no-underline hover:underline"
            >
              React skills
            </Link>
            .
          </p>
        </section>

        <p className="mt-8 text-sm">
          <Link href="/jobs" className="font-medium text-brand no-underline hover:underline">
            ← Back to all jobs
          </Link>
        </p>
      </div>
    </main>
  );
}

const LOGO_GRADIENT: Record<ReturnType<typeof accentFromId>, string> = {
  teal: "from-teal/80 to-teal/50",
  rose: "from-rose/80 to-rose/50",
  amber: "from-amber/80 to-amber/50",
  brand: "from-brand/90 to-brand/60",
};

function CompanyHubLogo({
  companyId,
  logoUrl,
  domain,
  name,
  size,
}: {
  companyId: string;
  logoUrl?: string | null;
  domain: string | null;
  name: string;
  size: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => {
    const s = logoUrl?.trim();
    if (s) return companyLogoSrcForDisplay(s);
    return clearbitFromDomain(domain) ?? "";
  }, [logoUrl, domain]);
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const accent = accentFromId(companyId);
  const box = size === "lg" ? "h-16 w-16 p-2" : "h-10 w-10 p-1";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl border border-ink/10 bg-white",
        box,
      )}
    >
      {!failed && src ? (
        <img
          src={src}
          alt=""
          width={size === "lg" ? 56 : 32}
          height={size === "lg" ? 56 : 32}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white",
            size === "lg" ? "text-lg" : "text-xs",
            LOGO_GRADIENT[accent],
          )}
          aria-hidden
        >
          {letter}
        </div>
      )}
    </div>
  );
}

function RelatedCompanyAvatar({ company }: { company: CompanyListItem }) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => {
    const s = company.logoUrl?.trim();
    if (s) return companyLogoSrcForDisplay(s);
    return clearbitFromDomain(company.domain) ?? "";
  }, [company.logoUrl, company.domain]);
  const letter = company.name.trim().charAt(0).toUpperCase() || "?";
  const accent = accentFromId(company.id);

  return (
    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-white p-0.5">
      {!failed && src ? (
        <img
          src={src}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center rounded-md bg-gradient-to-br text-xs font-bold text-white",
            LOGO_GRADIENT[accent],
          )}
          aria-hidden
        >
          {letter}
        </div>
      )}
    </div>
  );
}
