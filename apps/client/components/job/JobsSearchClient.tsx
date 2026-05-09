"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  ApiRequestError,
  createSavedSearch,
  deleteSavedSearch,
  fetchJobs,
  normalizeJobsListMeta,
  fetchSeoLandingPages,
  fetchSavedSearches,
  patchSavedSearchAlert,
  renameSavedSearch,
  isJobReady,
  type JobItem,
  type JobsApiResponse,
  type SavedSearchItem,
} from "../../lib/api";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { FREE_DISCOVERY, FREE_DISCOVERY_PREVIEW_JOB_ROWS } from "../../lib/planLimits";
import {
  parseJobFiltersFromSearch,
  filtersToSearchParams,
  hasActiveJobFilters,
  normalizeRelatedSlugPath,
  type JobFilters,
} from "../../lib/slug-parser";
import { signInWithNext } from "../../lib/signInUrl";
import { signalProgrammaticNavigation } from "../layout/RouteLoader";
import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { SortSegmented } from "../ui/SortSegmented";
import { FilterChips } from "../filters/FilterChips";
import type { JobsInlineUiFiltersState } from "./JobsInlineFilters";
import { JobList } from "./JobList";
import { ScrollCollapseChrome, useScrollRevealPromos } from "./ScrollCollapseChrome";
import { EmptyState } from "../ui/EmptyState";
import { cn } from "../../lib/cn";
import { jobloomChromeWebStoreUrl } from "../../lib/jobloomChromeStore";
import {
  JobsHeroDynamicLoading,
  JobsInlineFiltersDynamicLoading,
  LimitWallDynamicLoading,
} from "./jobsRouteDynamicFallbacks";
import {
  formatUserLocalResetDateTime,
  getUserLocalTimeZoneLabel,
} from "../../lib/userLocalResetTime";
import { UserLocalResetCaption } from "./UserLocalResetCaption";
import { JobsListingEmailCapturePopup } from "./JobsListingEmailCapturePopup";

const TimeAdvantageSimulator = dynamic(
  () => import("./TimeAdvantageSimulator").then((m) => m.TimeAdvantageSimulator),
  { loading: () => <JobsHeroDynamicLoading />, ssr: true },
);

const JobsInlineFilters = dynamic(
  () => import("./JobsInlineFilters").then((m) => m.JobsInlineFilters),
  { loading: () => <JobsInlineFiltersDynamicLoading />, ssr: true },
);

const LimitWallEnhanced = dynamic(
  () => import("./LimitWallEnhanced").then((m) => m.LimitWallEnhanced),
  { loading: () => <LimitWallDynamicLoading />, ssr: true },
);

function listQueryBase(f: JobFilters): JobFilters {
  const { offset: _o, page: _p, ...rest } = f;
  return rest;
}

interface Props {
  jobs: JobItem[];
  meta?: JobsApiResponse["meta"];
  weeklyJobsPosted?: number;
  relatedSlugs: string[];
  listingTop?: ReactNode;
  listingFaq?: ReactNode;
}

function discoverySurfaceFromPathname(pathname: string): "browse" | "seo" {
  if (pathname === "/jobs" || pathname === "/jobs/browse") return "browse";
  if (pathname.startsWith("/jobs/")) return "seo";
  return "browse";
}

function quotaDivider() {
  return (
    <div
      className="w-px shrink-0 self-stretch bg-ink/[0.07]"
      aria-hidden
    />
  );
}

/** Matches LimitWallEnhanced stat row typography (label + bold figure). */
function DiscoveryMeterCell({
  label,
  accent,
  secondary,
  children,
}: {
  label: string;
  accent?: boolean;
  /** Smaller line under the figure (e.g. jobs per search). */
  secondary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-center gap-1 px-3 py-2.5 sm:px-3.5",
        accent &&
          "relative bg-gradient-to-br from-brand/[0.07] via-white/50 to-transparent before:pointer-events-none before:absolute before:inset-y-2.5 before:left-0 before:w-px before:bg-gradient-to-b before:from-brand/45 before:via-brand/20 before:to-transparent before:content-['']",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
        {label}
      </p>
      <p
        className={cn(
          "font-sans text-xs font-bold tabular-nums leading-none tracking-wide",
          accent ? "text-brand" : "text-ink",
        )}
      >
        {children}
      </p>
      {secondary ? (
        <p className="text-[10px] font-semibold leading-tight tracking-wide text-ink/45">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

/** Locale + TZ strings must not run during SSR — Node locale/TZ differs from the browser and causes hydration mismatches. */
function DiscoveryQuotaResetAtPanel({ resetAt }: { resetAt: string }) {
  const [{ resetDateTime, resetTz }, setSnapshot] = useState({
    resetDateTime: "",
    resetTz: "",
  });

  useEffect(() => {
    setSnapshot({
      resetDateTime: formatUserLocalResetDateTime(resetAt),
      resetTz: getUserLocalTimeZoneLabel(resetAt),
    });
  }, [resetAt]);

  const showTz = Boolean(resetTz.trim());

  return (
    <div className="flex min-w-0 max-w-[14rem] flex-col justify-center gap-1 px-3 py-2.5 sm:max-w-[18rem] sm:px-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
        Resets
        {showTz ? (
          <span className="font-bold normal-case text-ink/50">
            {" "}
            ({resetTz})
          </span>
        ) : null}
      </p>
      <p className="break-words font-sans text-xs font-bold leading-snug tracking-wide text-ink/70">
        {resetDateTime.trim() ? resetDateTime : "\u00a0"}
      </p>
    </div>
  );
}

function FreeDiscoveryQuotaStrip({
  listMeta,
}: {
  listMeta: NonNullable<JobsApiResponse["meta"]>;
}) {
  if (listMeta.viewCapUnlimited !== false) return null;

  const isPage1PreviewStrip = listMeta.discoveryPhase === "preview";
  const cappedOut =
    listMeta.capReached === true &&
    typeof listMeta.remaining === "number" &&
    listMeta.remaining <= 0;
  /** Avoid `remaining ?? 0`: missing/null metered meta must not display as zero (looks like “quota exhausted”). */
  const remKnown =
    typeof listMeta.remaining === "number" && Number.isFinite(listMeta.remaining);
  const rem = remKnown ? Math.max(0, listMeta.remaining as number) : null;
  const resetAt = listMeta.resetAt;
  const showPreviewBadge =
    isPage1PreviewStrip ||
    cappedOut ||
    (rem !== null && rem < FREE_DISCOVERY.dailyJobs);

  const shell = cn(
    "inline-flex max-w-full items-stretch overflow-x-auto rounded-2xl border border-ink/[0.07] text-ink",
    "bg-gradient-to-br from-white via-[#fffaf8] to-[#f3f0ea]",
    "shadow-[0_16px_50px_-28px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.03]",
  );

  return (
    <div role="status" aria-live="polite" className={shell}>
      <div className="flex shrink-0 flex-col justify-center border-r border-ink/[0.06] bg-white/40 px-3 py-2.5 sm:px-3.5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink/38">
          Free
        </p>
      </div>
      {showPreviewBadge ? (
        <>
          <DiscoveryMeterCell label="Browse quota left today">
            <span className="tabular-nums text-ink">
              {rem === null ? (
                "—"
              ) : (
                <>
                  <span className="text-brand tabular-nums">{rem}</span>
                  <span className="text-ink/45"> of </span>
                  <span className="tabular-nums">{FREE_DISCOVERY.dailyJobs}</span>
                  <span className="text-ink/35"> remaining</span>
                </>
              )}
            </span>
          </DiscoveryMeterCell>
          {quotaDivider()}
          <DiscoveryMeterCell label={isPage1PreviewStrip ? "Now showing" : cappedOut ? "Status" : "Then"} accent>
            {isPage1PreviewStrip ? (
              <>Preview ×{FREE_DISCOVERY_PREVIEW_JOB_ROWS}</>
            ) : cappedOut ? (
              <>Browse limit reached</>
            ) : (
              <>{FREE_DISCOVERY_PREVIEW_JOB_ROWS} preview</>
            )}
          </DiscoveryMeterCell>
          {resetAt ? (
            <>
              {quotaDivider()}
              <DiscoveryQuotaResetAtPanel resetAt={resetAt} />
            </>
          ) : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:gap-x-4 sm:px-3.5 sm:pr-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Free views left today
            </p>
            <p className="font-sans text-xs font-bold tabular-nums leading-none tracking-wide text-ink">
              {rem === null ? (
                "—"
              ) : (
                <>
                  <span className="text-brand">{rem}</span>
                  <span className="text-ink/45"> of </span>
                  <span>{FREE_DISCOVERY.dailyJobs}</span>
                  <span className="text-ink/35"> remaining</span>
                </>
              )}
            </p>
          </div>
          <div
            className="hidden h-8 w-px bg-ink/[0.08] sm:block"
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
              Then
            </p>
            <p className="font-sans text-xs font-bold tabular-nums tracking-wide text-ink/80">
              {FREE_DISCOVERY_PREVIEW_JOB_ROWS} preview
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function toTitleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildSavedSearchDetails(
  query: string,
): Array<{ label: string; value: string }> {
  const [, raw = ""] = query.split("?");
  const filters = parseJobFiltersFromSearch(
    Object.fromEntries(new URLSearchParams(raw).entries()),
  );
  const details: Array<{ label: string; value: string }> = [];
  const role = filters.roles?.length
    ? filters.roles
    : filters.role
      ? [filters.role]
      : [];
  if (role.length > 0)
    details.push({
      label: "Role",
      value: role.map(toTitleCaseSlug).join(", "),
    });
  const catVals =
    filters.categories?.length
      ? filters.categories
      : filters.category
        ? [filters.category]
        : [];
  if (catVals.length > 0) {
    details.push({
      label: "Category",
      value: catVals.map(toTitleCaseSlug).join(", "),
    });
  }
  const work = filters.workTypes?.length
    ? filters.workTypes
    : filters.workType
      ? [filters.workType]
      : [];
  if (work.length > 0)
    details.push({
      label: "Work type",
      value: work.map(toTitleCaseSlug).join(", "),
    });
  if (filters.skills?.length) {
    details.push({
      label: "Skills",
      value: filters.skills.map(toTitleCaseSlug).join(", "),
    });
  }
  if (filters.experience)
    details.push({
      label: "Level",
      value: toTitleCaseSlug(filters.experience),
    });
  if (filters.posted) {
    const postedMap: Record<string, string> = {
      "24h": "Last 24h",
      "3d": "Last 3d",
      "1w": "Last week",
      "1m": "Last month",
    };
    details.push({
      label: "Posted",
      value: postedMap[filters.posted] ?? filters.posted,
    });
  }
  const location =
    filters.location ?? filters.locations?.join(", ") ?? filters.country;
  if (location)
    details.push({ label: "Location", value: toTitleCaseSlug(location) });
  return details;
}

function getNextSavedSearchName(rows: SavedSearchItem[], maxSlots: number): string {
  const used = new Set<number>();
  for (const row of rows) {
    const m = row.name?.trim().match(/^Saved search (\d+)$/i);
    if (m) used.add(Number(m[1]));
  }
  const cap = Math.max(1, Math.min(99, maxSlots));
  for (let i = 1; i <= cap; i += 1) {
    if (!used.has(i)) return `Saved search ${i}`;
  }
  return `Saved search ${rows.length + 1}`;
}

function normalizeQueryForMatch(query: string): string {
  const [rawPath, rawQs = ""] = query.split("?");
  const path = rawPath.startsWith("/jobs") ? "/jobs" : "/jobs";
  const params = new URLSearchParams(rawQs);
  const drop = new Set(["page", "limit", "offset"]);
  const rows = Array.from(params.entries())
    .filter(([k, v]) => !drop.has(k) && k.trim() && v.trim())
    .sort(([ka, va], [kb, vb]) => ka.localeCompare(kb) || va.localeCompare(vb));
  const normalized = new URLSearchParams();
  for (const [k, v] of rows) normalized.append(k, v);
  const qs = normalized.toString();
  return qs ? `${path}?${qs}` : path;
}

function formatAlertLastSent(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Never";
  const diff = Date.now() - t;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function JobsSearchClient({
  jobs,
  meta: initialMeta,
  weeklyJobsPosted,
  relatedSlugs,
  listingTop,
  listingFaq,
}: Props) {
  const { getToken, isSignedIn, isLoaded: authLoaded } = useAuth();
  const { isPro } = useAccountPlan();
  const [smartApplyBannerDismissed, setSmartApplyBannerDismissed] = useState(false);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [resolvedWeeklyJobsPosted, setResolvedWeeklyJobsPosted] = useState<number | undefined>(
    weeklyJobsPosted,
  );
  const [resolvedRelatedSlugs, setResolvedRelatedSlugs] = useState<string[]>(relatedSlugs);

  useEffect(() => {
    try {
      setSmartApplyBannerDismissed(
        typeof window !== "undefined" &&
          localStorage.getItem("smartApplyBannerDismissed") === "true",
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setResolvedWeeklyJobsPosted(weeklyJobsPosted);
  }, [weeklyJobsPosted]);

  useEffect(() => {
    setResolvedRelatedSlugs(relatedSlugs);
  }, [relatedSlugs]);

  useEffect(() => {
    let cancelled = false;
    if (resolvedWeeklyJobsPosted !== undefined) {
      return () => {
        cancelled = true;
      };
    }
    void fetchJobs({ posted: "1w", page: 1, limit: 1, sort: "latest" })
      .then((res) => {
        if (cancelled) return;
        const total = Number(res.meta?.total ?? 0);
        setResolvedWeeklyJobsPosted(Number.isFinite(total) && total >= 0 ? Math.round(total) : 0);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedWeeklyJobsPosted]);

  useEffect(() => {
    let cancelled = false;
    void fetchSeoLandingPages({ minCount: 5, maxSlugs: 150 })
      .then((seo) => {
        if (cancelled) return;
        const next = seo.data
          .map((e) => normalizeRelatedSlugPath(e.slug).replace(/^\/jobs\/?/, ""))
          .filter(Boolean)
          .slice(0, 8);
        if (next.length > 0) setResolvedRelatedSlugs(next);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      if (typeof window === "undefined") return;
      setExtensionPresent(window.__JOBSEEK_EXTENSION__ === true);
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();
  const urlFilters = useMemo(
    () => parseJobFiltersFromSearch(Object.fromEntries(searchParams.entries())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when URL string changes
    [urlKey],
  );

  const discoverySurface = useMemo(
    () => discoverySurfaceFromPathname(pathname),
    [pathname],
  );

  /** Stable identity for the current job search (ignores pagination and transient params like `appliedJob`). */
  const jobListFiltersKey = useMemo(
    () =>
      `${filtersToSearchParams(listQueryBase(urlFilters)).toString()}|${discoverySurface}`,
    [urlFilters, discoverySurface],
  );

  const [draft, setDraft] = useState<JobFilters>(urlFilters);
  const [uiFilters, setUiFilters] = useState<JobsInlineUiFiltersState>(() => ({
    roles: urlFilters.roles ?? (urlFilters.role ? [urlFilters.role] : []),
    types:
      urlFilters.workTypes ??
      (urlFilters.workType ? [urlFilters.workType] : []),
    locations: urlFilters.locations?.length
      ? urlFilters.locations
      : urlFilters.location
        ? [urlFilters.location]
        : urlFilters.country
          ? [urlFilters.country]
          : [],
    skills: urlFilters.skills ?? [],
    categories:
      urlFilters.categories?.length
        ? urlFilters.categories
        : urlFilters.category
          ? [urlFilters.category]
          : [],
  }));
  const [listJobs, setListJobs] = useState<JobItem[]>(() => jobs.filter(isJobReady));
  const [listMeta, setListMeta] = useState(() => normalizeJobsListMeta(initialMeta));
  const [loadingMore, setLoadingMore] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearchItem[]>([]);
  const [savedSearchLimit, setSavedSearchLimit] = useState(3);
  const [savingSearch, setSavingSearch] = useState(false);
  const [deletingSavedId, setDeletingSavedId] = useState<string | null>(null);
  const [editingSavedId, setEditingSavedId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renamingSavedId, setRenamingSavedId] = useState<string | null>(null);
  const [savedSearchNotice, setSavedSearchNotice] = useState<string | null>(
    null,
  );
  const [hoveredSavedId, setHoveredSavedId] = useState<string | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [alertUpdatingId, setAlertUpdatingId] = useState<string | null>(null);
  const [flashAppliedJobId, setFlashAppliedJobId] = useState<string | null>(null);
  const [isFilterPending, startFilterTransition] = useTransition();
  const scrollPromoChromeVisible = useScrollRevealPromos();
  /** Tracks which search the current `listJobs` / `listMeta` belong to; avoids wiping client "load more" on RSC refresh. */
  const listServerSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(urlFilters);
    setUiFilters({
      roles: urlFilters.roles ?? (urlFilters.role ? [urlFilters.role] : []),
      types:
        urlFilters.workTypes ??
        (urlFilters.workType ? [urlFilters.workType] : []),
      locations: urlFilters.locations?.length
        ? urlFilters.locations
        : urlFilters.location
          ? [urlFilters.location]
          : urlFilters.country
            ? [urlFilters.country]
            : [],
      skills: urlFilters.skills ?? [],
      categories:
        urlFilters.categories?.length
          ? urlFilters.categories
          : urlFilters.category
            ? [urlFilters.category]
            : [],
    });
  }, [urlFilters]);

  useEffect(() => {
    // Avoid reconciling RSC props while a client "Load more" is in flight or before its state commits:
    // otherwise we can briefly treat SSR page-1 meta as authoritative and freeze quota (e.g. stuck at 55).
    if (loadingMore) {
      return;
    }
    if (listServerSyncKeyRef.current !== jobListFiltersKey) {
      listServerSyncKeyRef.current = jobListFiltersKey;
      setListJobs(jobs.filter(isJobReady));
      setListMeta(normalizeJobsListMeta(initialMeta));
      return;
    }
    // Same search as last sync — parent likely re-rendered from RSC (e.g. `router.replace` after apply flash).
    // Do not shrink the list back to page 1; keep client-merged pages from "Load more".
    const ssrJobsLen = jobs.filter(isJobReady).length;
    setListJobs((prev) => {
      const next = jobs.filter(isJobReady);
      return prev.length > next.length ? prev : next;
    });
    setListMeta((prev) => {
      const prevPage = Number(prev?.page ?? 1) || 1;
      const serverPage = Number(initialMeta?.page ?? 1) || 1;
      const mergedBeyondSsr =
        listJobs.length > ssrJobsLen || prevPage > serverPage;
      if (prev && initialMeta && mergedBeyondSsr) {
        // SSR snapshot is still page 1 (and/or fewer rows); keep meter + pagination from the last client fetch.
        return prev;
      }
      return normalizeJobsListMeta(initialMeta) ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listJobs.length intentionally gates merged-list detection
  }, [jobs, initialMeta, jobListFiltersKey, listJobs.length, loadingMore]);

  useEffect(() => {
    let cancelled = false;
    if (!isSignedIn) {
      setSavedSearches([]);
      return;
    }
    void (async () => {
      try {
        const token = await getToken({ skipCache: true });
        if (!token) return;
        const res = await fetchSavedSearches(token);
        if (!cancelled) {
          setSavedSearches(res.data);
          setSavedSearchLimit(res.meta.limit);
        }
      } catch {
        // Non-blocking: listing still works without saved-search metadata.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn, urlKey]);

  useEffect(() => {
    // Clear transient notices whenever URL filters change.
    setSavedSearchNotice(null);
  }, [urlKey]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(urlKey);
    const markerFromUrl = params.get("appliedJob")?.trim() ?? "";
    let marker = markerFromUrl;
    if (!marker) {
      try {
        marker = window.sessionStorage.getItem("jobseek:applied-flash-job-id")?.trim() ?? "";
      } catch {
        marker = "";
      }
    }
    if (!marker) return;
    setFlashAppliedJobId(marker);
    try {
      window.sessionStorage.removeItem("jobseek:applied-flash-job-id");
    } catch {
      // ignore
    }
    if (markerFromUrl) {
      params.delete("appliedJob");
      const qs = params.toString();
      router.replace(qs ? `/jobs?${qs}` : "/jobs", { scroll: false });
    }
  }, [router, urlKey]);

  useEffect(() => {
    if (!flashAppliedJobId) return;
    const clear = () => setFlashAppliedJobId(null);
    const timeoutId = window.setTimeout(clear, 4000);
    window.addEventListener("pointerdown", clear, { once: true });
    window.addEventListener("keydown", clear, { once: true });
    window.addEventListener("scroll", clear, { once: true, passive: true });
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", clear);
      window.removeEventListener("keydown", clear);
      window.removeEventListener("scroll", clear);
    };
  }, [flashAppliedJobId]);

  const navigate = useCallback(
    (f: JobFilters) => {
      const params = filtersToSearchParams(f).toString();
      startFilterTransition(() => {
        router.push(params ? `/jobs?${params}` : "/jobs");
      });
    },
    [router, startFilterTransition],
  );

  const navigateProtected = useCallback(
    (path: string) => {
      if (!authLoaded) return;
      const dest = isSignedIn ? path : signInWithNext(path);
      signalProgrammaticNavigation(dest);
      router.push(dest);
    },
    [authLoaded, isSignedIn, router],
  );

  const onApply = useCallback(() => {
    setSavedSearchNotice(null);
    navigate({
      ...draft,
      role: uiFilters.roles[0],
      roles: uiFilters.roles.length ? uiFilters.roles : undefined,
      skills: uiFilters.skills.length ? uiFilters.skills : undefined,
      country: undefined,
      locations: uiFilters.locations.length ? uiFilters.locations : undefined,
      location: undefined,
      workType: undefined,
      workTypes: uiFilters.types.length ? uiFilters.types : undefined,
      category: undefined,
      categories: uiFilters.categories.length ? uiFilters.categories : undefined,
      page: undefined,
      offset: undefined,
    });
  }, [draft, navigate, uiFilters]);

  const onClearFilters = useCallback(() => {
    setSavedSearchNotice(null);
    startFilterTransition(() => {
      router.push("/jobs");
    });
  }, [router, startFilterTransition]);

  const onSortNavigate = useCallback(
    (sort: JobFilters["sort"]) => {
      navigate({
        ...urlFilters,
        sort: sort === "salary_desc" ? "salary_desc" : undefined,
        page: undefined,
        offset: undefined,
      });
    },
    [navigate, urlFilters],
  );

  const onRemoveChip = useCallback(
    (payload: { type: keyof JobFilters | "skill"; value?: string }) => {
      const updated: JobsInlineUiFiltersState = { ...uiFilters };
      const nextFilters: JobFilters = {
        ...urlFilters,
        page: undefined,
        offset: undefined,
      };

      if (payload.type === "location") {
        updated.locations = [];
        nextFilters.location = undefined;
        nextFilters.locations = undefined;
        nextFilters.country = undefined;
      } else if (payload.type === "country" && payload.value) {
        const baseLocs = urlFilters.locations?.length
          ? urlFilters.locations
          : urlFilters.location
            ? [urlFilters.location]
            : urlFilters.country
              ? [urlFilters.country]
              : [];
        const nextLocs = baseLocs.filter((v) => v !== payload.value);
        nextFilters.locations = nextLocs.length ? nextLocs : undefined;
        nextFilters.location = undefined;
        nextFilters.country = undefined;
        updated.locations = nextLocs;
      } else if (payload.type === "workType" && payload.value) {
        updated.types = uiFilters.types.filter((v) => v !== payload.value);
        nextFilters.workType = undefined;
        nextFilters.workTypes = updated.types.length
          ? updated.types
          : undefined;
      } else if (payload.type === "role" && payload.value) {
        updated.roles = uiFilters.roles.filter((v) => v !== payload.value);
        nextFilters.role = updated.roles[0];
        nextFilters.roles = updated.roles.length ? updated.roles : undefined;
      } else if (payload.type === "skill" && payload.value) {
        updated.skills = uiFilters.skills.filter((v) => v !== payload.value);
        nextFilters.skills = updated.skills.length ? updated.skills : undefined;
      } else if (payload.type === "isRemote") {
        updated.types = uiFilters.types.filter((v) => v !== "remote");
        nextFilters.workType = undefined;
        nextFilters.workTypes = updated.types.length
          ? updated.types
          : undefined;
        nextFilters.isRemote = undefined;
      } else if (payload.type === "experience") {
        nextFilters.experience = undefined;
      } else if (payload.type === "posted") {
        nextFilters.posted = undefined;
      } else if (payload.type === "minSalary") {
        nextFilters.minSalary = undefined;
      } else if (payload.type === "sort") {
        nextFilters.sort = undefined;
      } else if (payload.type === "companyId") {
        nextFilters.companyId = undefined;
      } else if (payload.type === "category" && payload.value) {
        const cur =
          urlFilters.categories?.length
            ? urlFilters.categories
            : urlFilters.category
              ? [urlFilters.category]
              : [];
        const nextCats = cur.filter((c) => c !== payload.value);
        nextFilters.categories = nextCats.length ? nextCats : undefined;
        nextFilters.category = undefined;
        updated.categories = nextCats;
      } else if (payload.type === "category") {
        nextFilters.category = undefined;
        nextFilters.categories = undefined;
        updated.categories = [];
      }

      nextFilters.role = updated.roles[0];
      nextFilters.roles = updated.roles.length ? updated.roles : undefined;
      nextFilters.workType = undefined;
      nextFilters.workTypes = updated.types.length ? updated.types : undefined;
      nextFilters.skills = updated.skills.length ? updated.skills : undefined;
      nextFilters.category = undefined;
      nextFilters.categories = updated.categories.length
        ? updated.categories
        : undefined;

      setUiFilters(updated);
      navigate(nextFilters);
    },
    [uiFilters, urlFilters, navigate],
  );

  const hasMoreByPagination = Boolean(
    listMeta &&
      (listMeta.hasMore === true ||
        (listMeta.totalPages != null && listMeta.page < listMeta.totalPages)),
  );
  const meteredLoadBlocked = Boolean(
    listMeta &&
      listMeta.viewCapUnlimited === false &&
      (listMeta.capReached === true ||
        listMeta.discoveryPhase === "preview" ||
        (typeof listMeta.remaining === "number" && listMeta.remaining <= 0)),
  );
  const canLoadMore = hasMoreByPagination && !meteredLoadBlocked;

  const onLoadMore = useCallback(async () => {
    if (!listMeta || loadingMore || !canLoadMore) return;
    setLoadingMore(true);
    try {
      const cur = Number(listMeta?.page);
      const currentPage =
        Number.isFinite(cur) && cur >= 1 ? Math.floor(cur) : 1;
      const nextPage = currentPage + 1;
      const base = listQueryBase(urlFilters);
      const token = await getToken();
      const res = await fetchJobs(
        {
          ...base,
          page: nextPage,
          limit: listMeta.pageSize || 20,
          surface: discoverySurface,
        },
        { token },
      );
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
      setListMeta((prev) => {
        const next = normalizeJobsListMeta(res.meta);
        if (!prev || !next) return next ?? prev;
        const blockedPagination =
          res.data.length === 0 &&
          next.capReached === true &&
          next.discoveryPhase !== "preview";
        const prevTotal = prev.total ?? prev.totalCount;
        const nextTotal = next.total ?? next.totalCount;
        const preserveTotals =
          blockedPagination &&
          typeof prevTotal === "number" &&
          prevTotal > 0 &&
          (nextTotal === 0 ||
            nextTotal === null ||
            nextTotal === undefined ||
            Number.isNaN(Number(nextTotal)));
        if (preserveTotals) {
          return normalizeJobsListMeta({
            ...next,
            total: prevTotal,
            totalCount: prev.totalCount ?? prevTotal,
            totalPages: prev.totalPages ?? next.totalPages,
          });
        }
        return next;
      });
    } catch {
      // CORS / network: leave list as-is; devtools will show the error.
    } finally {
      setLoadingMore(false);
    }
  }, [listMeta, loadingMore, canLoadMore, urlFilters, getToken, discoverySurface]);

  const canonicalQuery = useMemo(() => {
    return urlKey ? `/jobs?${urlKey}` : "/jobs";
  }, [urlKey]);

  const savedMatch = useMemo(() => {
    const current = normalizeQueryForMatch(canonicalQuery);
    return (
      savedSearches.find(
        (item) => normalizeQueryForMatch(item.query) === current,
      ) ?? null
    );
  }, [savedSearches, canonicalQuery]);

  const canSaveAnother = savedSearches.length < savedSearchLimit;
  const canSaveCurrentQuery = canonicalQuery !== "/jobs";

  const onSaveSearch = useCallback(async () => {
    if (!isSignedIn) {
      const dest = signInWithNext(canonicalQuery);
      signalProgrammaticNavigation(dest);
      router.push(dest);
      return;
    }

    if (savedMatch) {
      return;
    }
    if (!canSaveCurrentQuery) {
      return;
    }
    if (!canSaveAnother) {
      setSavedSearchNotice(`Max ${savedSearchLimit} saved searches reached`);
      return;
    }

    setSavingSearch(true);
    setSavedSearchNotice(null);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) {
        setSavedSearchNotice("Sign in to save searches");
        return;
      }
      const autoName = getNextSavedSearchName(savedSearches, savedSearchLimit);
      const created = await createSavedSearch(token, {
        query: canonicalQuery,
        name: autoName,
      });
      setSavedSearches((prev) =>
        prev.some((item) => item.query === created.query)
          ? prev
          : [created, ...prev],
      );
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === "SAVED_SEARCH_LIMIT_REACHED"
      ) {
        // No toast needed; button/inline max state already reflects this.
      } else {
        setSavedSearchNotice("Could not save search");
      }
    } finally {
      setSavingSearch(false);
    }
  }, [
    canSaveAnother,
    canSaveCurrentQuery,
    canonicalQuery,
    getToken,
    isSignedIn,
    router,
    savedMatch,
    savedSearches,
    savedSearchLimit,
  ]);

  const onDeleteSavedSearch = useCallback(
    async (id: string) => {
      if (!isSignedIn || deletingSavedId) return;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      const prev = savedSearches;
      setDeletingSavedId(id);
      setSavedSearches((rows) => rows.filter((row) => row.id !== id));
      try {
        await deleteSavedSearch(token, id);
      } catch {
        setSavedSearches(prev);
        setSavedSearchNotice("Could not delete saved search");
      } finally {
        setDeletingSavedId(null);
      }
    },
    [deletingSavedId, getToken, isSignedIn, savedSearches],
  );

  const onStartRenameSavedSearch = useCallback((saved: SavedSearchItem) => {
    setEditingSavedId(saved.id);
    setEditingName(saved.name?.trim() || "");
  }, []);

  const onRenameSavedSearch = useCallback(
    async (id: string) => {
      if (!isSignedIn || renamingSavedId) return;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      const nextName = editingName.trim();
      const prev = savedSearches;
      setRenamingSavedId(id);
      setSavedSearches((rows) =>
        rows.map((row) =>
          row.id === id ? { ...row, name: nextName || null } : row,
        ),
      );
      try {
        const updated = await renameSavedSearch(token, id, nextName || null);
        setSavedSearches((rows) =>
          rows.map((row) => (row.id === id ? updated : row)),
        );
        setEditingSavedId(null);
        setEditingName("");
      } catch {
        setSavedSearches(prev);
        setSavedSearchNotice("Could not rename saved search");
      } finally {
        setRenamingSavedId(null);
      }
    },
    [editingName, getToken, isSignedIn, renamingSavedId, savedSearches],
  );

  const onAlertSavedSearch = useCallback(
    async (saved: SavedSearchItem, enabled: boolean, threshold?: 5 | 10) => {
      if (!isSignedIn || !isPro || alertUpdatingId) return;
      const token = await getToken({ skipCache: true });
      if (!token) return;
      setAlertUpdatingId(saved.id);
      try {
        const resolvedThreshold: 5 | 10 =
          threshold ?? (saved.alertThreshold === 10 ? 10 : 5);
        const updated = await patchSavedSearchAlert(token, saved.id, {
          enabled,
          threshold: resolvedThreshold,
        });
        setSavedSearches((rows) =>
          rows.map((row) => (row.id === saved.id ? updated : row)),
        );
      } catch {
        setSavedSearchNotice("Could not update job alerts");
      } finally {
        setAlertUpdatingId(null);
      }
    },
    [alertUpdatingId, getToken, isPro, isSignedIn],
  );

  const hasAnyJobAlert = useMemo(
    () => savedSearches.some((s) => s.alertEnabled),
    [savedSearches],
  );

  /** Pro users with no alert enabled on any saved search — nudge toward hover UI in popover. */
  const proJobAlertHint =
    isPro && isSignedIn && !hasAnyJobAlert
      ? savedSearches.length === 0
        ? "Save a search, then hover it to enable job alerts."
        : "Hover a saved search to enable job alerts."
      : null;

  const dismissSmartApplyBanner = useCallback(() => {
    try {
      localStorage.setItem("smartApplyBannerDismissed", "true");
    } catch {
      /* ignore */
    }
    setSmartApplyBannerDismissed(true);
  }, []);

  const showSmartApplyInstallBanner =
    isSignedIn && isPro && !extensionPresent && !smartApplyBannerDismissed;

  return (
    <div className="relative z-0 flex min-h-screen flex-col">
      <div className="-mb-6 w-full sm:-mb-8">
        <TimeAdvantageSimulator
          jobsPostedThisWeek={resolvedWeeklyJobsPosted}
          statRowPrefix={
            <button
              type="button"
              onClick={() => navigateProtected("/smart-apply")}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-white/90 px-3 py-1.5 text-sm font-semibold text-brand shadow-sm transition-colors hover:bg-brand/5"
              title="Smart Apply fills job forms automatically using your profile. You review and submit - always in control."
            >
              Smart Apply ⚡
            </button>
          }
        />
      </div>

      <Container width="jobs" className="pb-2 pt-0">
        {listingTop}
        {showSmartApplyInstallBanner ? (
          <div
            className="mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-[rgba(232,83,58,0.2)] px-4 py-3"
            style={{
              background: "linear-gradient(135deg, #fff8f6, #ffffff)",
            }}
          >
            <span className="text-lg" aria-hidden>
              ⚡
            </span>
            <div className="min-w-0 flex-1 basis-[min(100%,16rem)]">
              <p className="text-base font-semibold text-ink sm:text-sm">Smart Apply is ready</p>
              <p className="m-0 text-sm text-[#666] sm:text-[13px]">
                Install the Chrome extension to auto-fill job applications
              </p>
            </div>
            <a
              href={jobloomChromeWebStoreUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white no-underline sm:min-h-0 sm:text-[13px]"
              style={{ background: "#E8533A" }}
            >
              Install →
            </a>
            <button
              type="button"
              onClick={dismissSmartApplyBanner}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center border-0 bg-transparent p-1 text-ink/50 hover:text-ink sm:min-h-0 sm:min-w-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ) : null}
      </Container>

      <div
        id="section-filters"
        className={cn(
          "relative z-[50] bg-canvas/95 py-3 backdrop-blur-sm sm:py-4",
          "lg:sticky lg:top-16 lg:backdrop-blur-sm",
        )}
      >
        <Container
          width="jobs"
          className="rounded-none bg-canvas pb-1 pt-1 shadow-sm"
        >
          <JobsInlineFilters
            draft={draft}
            appliedFilters={urlFilters}
            setDraft={setDraft}
            uiFilters={uiFilters}
            setUiFilters={setUiFilters}
            onApply={onApply}
            onClearFilters={onClearFilters}
            clearFiltersDisabled={!hasActiveJobFilters(urlFilters)}
            onRemoveChip={onRemoveChip}
            onSortNavigate={onSortNavigate}
            showSort={false}
            showChips={false}
            totalRoles={listMeta?.total ?? undefined}
            selectedCategories={uiFilters.categories}
            onCategoryToggle={(slug) =>
              setUiFilters((prev) => ({
                ...prev,
                categories: prev.categories.includes(slug)
                  ? prev.categories.filter((c) => c !== slug)
                  : [...prev.categories, slug],
              }))
            }
          />
          <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Button
                variant={savedMatch ? "primary" : "outline"}
                size="sm"
                onClick={() => void onSaveSearch()}
                disabled={
                  savingSearch || savedMatch != null || !canSaveCurrentQuery
                }
                title={
                  !canSaveAnother ? `Only ${savedSearchLimit} saved searches allowed` : undefined
                }
              >
                {savedMatch
                  ? "Saved ✓"
                  : savingSearch
                    ? "Saving…"
                    : "Save search"}
              </Button>
              {proJobAlertHint ? (
                <span
                  className="max-w-[16rem] text-[11px] leading-snug text-ink/55"
                  role="note"
                >
                  {proJobAlertHint}
                </span>
              ) : null}
              {savedSearches.map((saved) => {
                const details = buildSavedSearchDetails(saved.query);
                const isActiveSaved =
                  normalizeQueryForMatch(saved.query) ===
                  normalizeQueryForMatch(canonicalQuery);
                const displayName = saved.name?.trim() || "Saved search";
                const isPopoverOpen =
                  hoveredSavedId === saved.id || editingSavedId === saved.id;
                return (
                  <div
                    key={saved.id}
                    className="relative"
                    onMouseEnter={() => {
                      if (hoverCloseTimerRef.current) {
                        clearTimeout(hoverCloseTimerRef.current);
                        hoverCloseTimerRef.current = null;
                      }
                      setHoveredSavedId(saved.id);
                    }}
                    onMouseLeave={() => {
                      if (hoverCloseTimerRef.current) {
                        clearTimeout(hoverCloseTimerRef.current);
                      }
                      hoverCloseTimerRef.current = setTimeout(() => {
                        setHoveredSavedId((prev) =>
                          prev === saved.id ? null : prev,
                        );
                      }, 180);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        startFilterTransition(() => {
                          signalProgrammaticNavigation(saved.query);
                          router.push(saved.query);
                        })
                      }
                      aria-current={isActiveSaved ? "page" : undefined}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        isActiveSaved
                          ? "border-brand bg-brand/10 text-brand shadow-sm"
                          : "border-ink/15 bg-surface text-ink hover:border-brand/30 hover:text-brand"
                      }`}
                      title={displayName}
                    >
                      <span className="inline-flex items-center gap-1">
                        {saved.alertEnabled ? (
                          <span className="text-[10px]" aria-hidden title="Alerts on">
                            🔔
                          </span>
                        ) : null}
                        {displayName}
                      </span>
                    </button>
                    <div
                      className={`absolute bottom-full left-1/2 top-auto z-20 mb-0 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-1 rounded-xl border border-ink/10 bg-surface p-3.5 text-xs leading-relaxed text-ink shadow-lg ring-1 ring-ink/5 transition ${
                        isPopoverOpen
                          ? "pointer-events-auto opacity-100"
                          : "pointer-events-none opacity-0"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 font-semibold text-ink">
                          {displayName}
                        </p>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-ink transition-colors hover:bg-ink/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onStartRenameSavedSearch(saved);
                            }}
                            aria-label="Rename saved search"
                            title="Rename saved search"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.75}
                              stroke="currentColor"
                              className="h-4 w-4"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-ink transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 disabled:pointer-events-none disabled:opacity-40"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDeleteSavedSearch(saved.id);
                            }}
                            disabled={deletingSavedId === saved.id}
                            aria-label="Delete saved search"
                            title="Delete saved search"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.75}
                              stroke="currentColor"
                              className="h-4 w-4"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {editingSavedId === saved.id ? (
                        <div className="pointer-events-auto mt-2 flex items-center gap-2">
                          <input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="h-8 w-full rounded-lg border border-ink/20 bg-white px-2.5 text-xs text-ink placeholder:text-ink-muted shadow-sm focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/20"
                            placeholder="Saved search name"
                            maxLength={80}
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-hover"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onRenameSavedSearch(saved.id);
                            }}
                            disabled={renamingSavedId === saved.id}
                          >
                            Save
                          </button>
                        </div>
                      ) : null}
                      {details.length > 0 ? (
                        <div className="mt-3 max-h-40 space-y-2.5 overflow-y-auto pr-0.5">
                          {details.map((row) => (
                            <div
                              key={`${saved.id}-${row.label}`}
                              className="text-xs leading-snug"
                            >
                              <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                                {row.label}
                              </span>
                              <span className="mt-0.5 block break-words text-ink/90">
                                {row.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-ink-muted">No filters</p>
                      )}
                      <div className="pointer-events-auto mt-3 rounded-lg border border-brand/25 bg-brand/5 p-3 ring-1 ring-brand/10">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
                          <span aria-hidden className="text-base leading-none">
                            🔔
                          </span>
                          Job alerts
                        </p>
                        {isPro ? (
                          <div className="mt-2.5 space-y-2">
                            <label className="flex cursor-pointer items-start gap-2 text-ink">
                              <input
                                type="checkbox"
                                checked={saved.alertEnabled}
                                disabled={alertUpdatingId === saved.id}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  void onAlertSavedSearch(saved, e.target.checked);
                                }}
                                className="mt-0.5 rounded border-ink/30 text-brand focus:ring-brand/30"
                              />
                              <span className="leading-snug">
                                Email when new jobs match
                              </span>
                            </label>
                            <div className="flex flex-wrap items-center gap-2 text-ink/80">
                              <span>Notify every</span>
                              <select
                                className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs font-medium text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                                value={saved.alertThreshold === 10 ? 10 : 5}
                                disabled={
                                  alertUpdatingId === saved.id || !saved.alertEnabled
                                }
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const v = (Number(e.target.value) === 10 ? 10 : 5) as 5 | 10;
                                  void onAlertSavedSearch(saved, true, v);
                                }}
                              >
                                <option value={5}>5</option>
                                <option value={10}>10</option>
                              </select>
                              <span>new jobs</span>
                            </div>
                            <p className="text-[11px] text-ink/55">
                              Last sent: {formatAlertLastSent(saved.alertLastSentAt)}
                            </p>
                          </div>
                        ) : (
                          <div className="mt-2.5 space-y-2">
                            <p className="leading-snug text-ink/85">
                              <span className="mr-1.5 inline-flex rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                                Pro
                              </span>
                              Get notified when new jobs match this search
                            </p>
                            <Link
                              href="/pricing"
                              className="inline-block text-sm font-semibold text-brand underline underline-offset-2 hover:text-brand-hover"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Upgrade to unlock →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {editingSavedId ? (
                <button
                  type="button"
                  className="text-xs text-ink/60 underline"
                  onClick={() => {
                    setEditingSavedId(null);
                    setEditingName("");
                  }}
                >
                  Cancel rename
                </button>
              ) : null}
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0 sm:gap-3">
              {!isPro && listMeta && listMeta.viewCapUnlimited === false ? (
                <FreeDiscoveryQuotaStrip listMeta={listMeta} />
              ) : null}
              <div className="min-w-0 sm:min-w-[220px]">
                <SortSegmented
                  value={
                    urlFilters.sort === "salary_desc" ? "salary_desc" : "latest"
                  }
                  onChange={(v) =>
                    onSortNavigate(
                      v === "salary_desc" ? "salary_desc" : undefined,
                    )
                  }
                  totalRoles={listMeta?.total ?? undefined}
                />
              </div>
            </div>
          </div>
          {isSignedIn && !isPro ? (
            <ScrollCollapseChrome
              show={scrollPromoChromeVisible}
              className={cn(
                "transition-[margin-bottom] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrollPromoChromeVisible ? "mb-3" : "mb-0",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2.5 text-xs text-ink">
                <span>
                  <span aria-hidden className="mr-1.5">
                    📧
                  </span>
                  Get notified when new jobs match your saved searches
                </span>
                <Link
                  href="/pricing"
                  className="shrink-0 font-semibold text-brand hover:underline"
                >
                  Enable job alerts →
                </Link>
              </div>
            </ScrollCollapseChrome>
          ) : null}
          {savedSearchNotice ? (
            <p className="mb-2 text-xs text-ink-muted" role="status">
              {savedSearchNotice}
            </p>
          ) : null}
          <FilterChips filters={urlFilters} onRemoveChip={onRemoveChip} />
          {!isPro &&
          listMeta &&
          listMeta.viewCapUnlimited === false &&
          typeof listMeta.remaining === "number" &&
          listMeta.remaining <= 45 ? (
            <div
              role="status"
              className="mt-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-ink"
            >
              You are nearing today&apos;s limit. Upgrade for unlimited access.
            </div>
          ) : null}
          {listMeta?.capReached &&
          !listMeta?.viewCapUnlimited &&
          !isPro &&
          (listMeta?.total ?? 0) > 0 &&
          listMeta?.discoveryPhase !== "preview" ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 flex flex-col gap-2 rounded-xl border border-brand/25 bg-gradient-to-br from-brand/10 to-white px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  More new roles came in for this search
                </p>
                <p className="mt-0.5 text-xs leading-snug text-ink/70">
                  You&apos;ve reached today&apos;s free browse limit—upgrade to see every new listing
                  and full details.
                </p>
                {listMeta.resetAt ? (
                  <UserLocalResetCaption
                    iso={listMeta.resetAt}
                    className="mt-1 text-[11px] text-ink/50"
                    muted
                  />
                ) : null}
              </div>
              <Link
                href="/pricing"
                className="shrink-0 rounded-lg bg-brand px-4 py-2 text-center text-sm font-semibold text-white no-underline shadow-sm transition-colors hover:bg-brand-hover"
              >
                Upgrade to view all
              </Link>
            </div>
          ) : null}
        </Container>
        {isFilterPending ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[4px] overflow-hidden"
            aria-hidden
          >
            <div
              className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/45 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute top-0 h-full w-[min(30%,10rem)] min-w-[4rem] rounded-full bg-gradient-to-r from-brand/25 via-brand to-brand/25 shadow-[0_0_14px_rgba(232,122,93,0.55),0_0_26px_rgba(232,122,93,0.22)] motion-reduce:animate-none motion-reduce:left-[35%] motion-reduce:opacity-90 animate-jobs-filter-sweep"
                style={{ willChange: "left" }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <Container
        width="jobs"
        className={cn(
          "mt-4 transition-opacity duration-200",
          isFilterPending && "pointer-events-none opacity-60",
        )}
        aria-busy={isFilterPending}
      >
        {(() => {
          const isPreviewPhase = listMeta?.discoveryPhase === "preview";
          const isCapped = listMeta?.capReached === true;
          const meteredAccess = listMeta?.viewCapUnlimited === false;
          const enforceWallUi = Boolean(meteredAccess && (isCapped || isPreviewPhase));
          const totalMatches = listMeta?.total ?? 0;
          const noMatches = listJobs.length === 0 && totalMatches === 0;
          const discoveryPhase = listMeta?.discoveryPhase;
          const showDiscoveryWall = Boolean(
            !isPro &&
              enforceWallUi &&
              listMeta &&
              listMeta.viewCapUnlimited === false &&
              listMeta.resetAt &&
              !noMatches &&
              listJobs.length > 0 &&
              (discoveryPhase === "search" ||
                discoveryPhase === "preview" ||
                discoveryPhase === undefined),
          );
          const hiddenForWall =
            discoveryPhase === "preview"
              ? Math.max(0, listMeta?.totalHidden ?? 0)
              : Math.max(0, totalMatches - listJobs.length);
          if (noMatches) {
            return (
              <EmptyState
                onTryRemote={() =>
                  navigate({
                    ...draft,
                    workType: undefined,
                    workTypes: ["remote"],
                    isRemote: true,
                    page: undefined,
                    offset: undefined,
                  })
                }
                onClearCountry={
                  uiFilters.locations.length > 0 ||
                  urlFilters.location ||
                  (urlFilters.locations?.length ?? 0) > 0 ||
                  urlFilters.country
                    ? () => {
                        setUiFilters((prev) => ({ ...prev, locations: [] }));
                        navigate({
                          ...urlFilters,
                          country: undefined,
                          locations: undefined,
                          location: undefined,
                          page: undefined,
                          offset: undefined,
                        });
                      }
                    : undefined
                }
              />
            );
          }
          const capResetAt = listMeta?.resetAt;
          const jobsForList =
            isPreviewPhase
              ? listJobs.slice(0, FREE_DISCOVERY_PREVIEW_JOB_ROWS)
              : listJobs;
          const wallPhase = discoveryPhase === "preview" ? "preview" : "search";
          return (
            <>
              {listJobs.length > 0 ? (
                <JobList jobs={jobsForList} flashAppliedJobId={flashAppliedJobId} />
              ) : null}
              {showDiscoveryWall && capResetAt ? (
                <LimitWallEnhanced
                  resetAt={capResetAt}
                  count={hiddenForWall}
                  previewJobs={jobsForList}
                  phase={wallPhase}
                  scrollRevealSubcopy={scrollPromoChromeVisible}
                />
              ) : null}
              {canLoadMore ? (
                <div className="mt-12 flex justify-center">
                  <Button
                    variant="outline"
                    outlineTone="teal"
                    size="md"
                    onClick={() => void onLoadMore()}
                    disabled={loadingMore}
                    className="px-8 shadow-md ring-1 ring-ink/5 disabled:hover:scale-100"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          );
        })()}
      </Container>

      {listingFaq ? (
        <Container width="jobs" className="mt-14">
          {listingFaq}
        </Container>
      ) : null}

      <Container width="jobs" className="mt-20 border-t border-ink/10 pt-12">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">
          Related searches
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {resolvedRelatedSlugs.map((slug) => (
            <Link
              key={slug}
              href={normalizeRelatedSlugPath(slug)}
              className="rounded-full bg-surface/90 px-4 py-2 text-sm text-ink/70 no-underline shadow-sm ring-1 ring-ink/5 transition-all hover:-translate-y-0.5 hover:text-brand hover:ring-brand/20"
            >
              {slug
                .split("/")
                .filter(Boolean)
                .map((part) => part.replace(/-/g, " "))
                .join(" ")}
            </Link>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-ink/55">
          <Link
            href="/jobs/browse"
            className="font-semibold text-brand no-underline hover:underline"
          >
            Browse all categories and skill hubs
          </Link>
        </p>
      </Container>

      <JobsListingEmailCapturePopup />
    </div>
  );
}
