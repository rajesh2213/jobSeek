"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ApiRequestError,
  createSavedSearch,
  deleteSavedSearch,
  fetchJobs,
  fetchSavedSearches,
  renameSavedSearch,
  type JobItem,
  type JobsApiResponse,
  type SavedSearchItem,
} from "../../lib/api";
import {
  parseJobFiltersFromSearch,
  filtersToSearchParams,
  type JobFilters,
} from "../../lib/slug-parser";
import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { SortSegmented } from "../ui/SortSegmented";
import { FilterChips } from "../filters/FilterChips";
import { JobsInlineFilters } from "./JobsInlineFilters";
import { JobList } from "./JobList";
import { DailyCapWall } from "./DailyCapWall";
import { EmptyState } from "../ui/EmptyState";

function listQueryBase(f: JobFilters): JobFilters {
  const { offset: _o, page: _p, ...rest } = f;
  return rest;
}

interface Props {
  jobs: JobItem[];
  meta?: JobsApiResponse["meta"];
  relatedSlugs: string[];
}

interface UiFiltersState {
  roles: string[];
  types: Array<"remote" | "onsite" | "hybrid">;
  /** Region name, ISO code, or city text for `?location=`. */
  location?: string;
  skills: string[];
}

const HERO_LEAD = "Discover your next ";
const HERO_ACCENT = "chapter.";

function splitCharacters(text: string): string[] {
  return Array.from(text);
}

function toTitleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildSavedSearchDetails(query: string): Array<{ label: string; value: string }> {
  const [, raw = ""] = query.split("?");
  const filters = parseJobFiltersFromSearch(Object.fromEntries(new URLSearchParams(raw).entries()));
  const details: Array<{ label: string; value: string }> = [];
  const role = filters.roles?.length ? filters.roles : filters.role ? [filters.role] : [];
  if (role.length > 0) details.push({ label: "Role", value: role.map(toTitleCaseSlug).join(", ") });
  if (filters.category) details.push({ label: "Category", value: toTitleCaseSlug(filters.category) });
  const work = filters.workTypes?.length ? filters.workTypes : filters.workType ? [filters.workType] : [];
  if (work.length > 0) details.push({ label: "Work type", value: work.map(toTitleCaseSlug).join(", ") });
  if (filters.skills?.length) {
    details.push({ label: "Skills", value: filters.skills.map(toTitleCaseSlug).join(", ") });
  }
  if (filters.experience) details.push({ label: "Level", value: toTitleCaseSlug(filters.experience) });
  if (filters.posted) {
    const postedMap: Record<string, string> = { "24h": "Last 24h", "3d": "Last 3d", "1w": "Last week", "1m": "Last month" };
    details.push({ label: "Posted", value: postedMap[filters.posted] ?? filters.posted });
  }
  const location = filters.location ?? filters.locations?.join(", ") ?? filters.country;
  if (location) details.push({ label: "Location", value: toTitleCaseSlug(location) });
  return details;
}

function getNextSavedSearchName(rows: SavedSearchItem[]): string {
  const used = new Set<number>();
  for (const row of rows) {
    const m = row.name?.trim().match(/^Saved search (\d+)$/i);
    if (m) used.add(Number(m[1]));
  }
  for (let i = 1; i <= 3; i += 1) {
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

export function JobsSearchClient({ jobs, meta: initialMeta, relatedSlugs }: Props) {
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 220], [1, 0]);
  const heroY = useTransform(scrollY, [0, 220], [0, -40]);

  const urlFilters = useMemo(
    () => parseJobFiltersFromSearch(Object.fromEntries(searchParams.entries())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync when URL string changes
    [urlKey],
  );

  const [draft, setDraft] = useState<JobFilters>(urlFilters);
  const [uiFilters, setUiFilters] = useState<UiFiltersState>(() => ({
    roles: urlFilters.roles ?? (urlFilters.role ? [urlFilters.role] : []),
    types: urlFilters.workTypes ?? (urlFilters.workType ? [urlFilters.workType] : []),
    location:
      urlFilters.location ??
      (urlFilters.locations?.length === 1 ? urlFilters.locations[0] : undefined) ??
      urlFilters.country,
    skills: urlFilters.skills ?? [],
  }));
  const [listJobs, setListJobs] = useState<JobItem[]>(jobs);
  const [listMeta, setListMeta] = useState(initialMeta);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearchItem[]>([]);
  const [savingSearch, setSavingSearch] = useState(false);
  const [deletingSavedId, setDeletingSavedId] = useState<string | null>(null);
  const [editingSavedId, setEditingSavedId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renamingSavedId, setRenamingSavedId] = useState<string | null>(null);
  const [savedSearchNotice, setSavedSearchNotice] = useState<string | null>(null);
  const [hoveredSavedId, setHoveredSavedId] = useState<string | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(urlFilters);
    setUiFilters({
      roles: urlFilters.roles ?? (urlFilters.role ? [urlFilters.role] : []),
      types: urlFilters.workTypes ?? (urlFilters.workType ? [urlFilters.workType] : []),
      location:
        urlFilters.location ??
        (urlFilters.locations?.length === 1 ? urlFilters.locations[0] : undefined) ??
        urlFilters.country,
      skills: urlFilters.skills ?? [],
    });
  }, [urlFilters]);

  useEffect(() => {
    setListJobs(jobs);
    setListMeta(initialMeta);
  }, [jobs, initialMeta]);

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
        if (!cancelled) setSavedSearches(res.data);
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

  const navigate = useCallback(
    (f: JobFilters) => {
      const params = filtersToSearchParams(f).toString();
      router.push(params ? `/jobs?${params}` : "/jobs");
    },
    [router],
  );

  const onApply = useCallback(() => {
    setSavedSearchNotice(null);
    navigate({
      ...draft,
      role: uiFilters.roles[0],
      roles: uiFilters.roles.length ? uiFilters.roles : undefined,
      skills: uiFilters.skills.length ? uiFilters.skills : undefined,
      country: undefined,
      locations: undefined,
      location: uiFilters.location?.trim() || undefined,
      workType: undefined,
      workTypes: uiFilters.types.length ? uiFilters.types : undefined,
      page: undefined,
      offset: undefined,
    });
  }, [draft, navigate, uiFilters]);

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
      const updated: UiFiltersState = { ...uiFilters };
      const nextFilters: JobFilters = {
        ...urlFilters,
        page: undefined,
        offset: undefined,
      };

      if (payload.type === "location") {
        updated.location = undefined;
        nextFilters.location = undefined;
        nextFilters.locations = undefined;
        nextFilters.country = undefined;
      } else if (payload.type === "country" && payload.value) {
        const nextLocs = (urlFilters.locations ?? []).filter((v) => v !== payload.value);
        nextFilters.locations = nextLocs.length ? nextLocs : undefined;
        nextFilters.country = undefined;
        nextFilters.location = nextLocs.length === 1 ? nextLocs[0] : undefined;
        updated.location = nextLocs.length === 1 ? nextLocs[0] : undefined;
      } else if (payload.type === "workType" && payload.value) {
        updated.types = uiFilters.types.filter((v) => v !== payload.value);
        nextFilters.workType = undefined;
        nextFilters.workTypes = updated.types.length ? updated.types : undefined;
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
        nextFilters.workTypes = updated.types.length ? updated.types : undefined;
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
      } else if (payload.type === "category") {
        nextFilters.category = undefined;
      }

      // Keep URL aligned with central multi-select state.
      nextFilters.role = updated.roles[0];
      nextFilters.roles = updated.roles.length ? updated.roles : undefined;
      nextFilters.workType = undefined;
      nextFilters.workTypes = updated.types.length ? updated.types : undefined;
      nextFilters.country = undefined;
      nextFilters.locations = undefined;
      nextFilters.location = updated.location?.trim() || undefined;
      nextFilters.skills = updated.skills.length ? updated.skills : undefined;

      setUiFilters(updated);
      navigate(nextFilters);
    },
    [uiFilters, urlFilters, navigate],
  );

  const canLoadMore =
    !listMeta?.capReached &&
    listMeta &&
    (listMeta.hasMore === true ||
      (listMeta.totalPages != null && listMeta.page < listMeta.totalPages));

  const onLoadMore = useCallback(async () => {
    if (!listMeta || loadingMore || !canLoadMore) return;
    setLoadingMore(true);
    try {
      const nextPage = listMeta.page + 1;
      const base = listQueryBase(urlFilters);
      const token = await getToken();
      const res = await fetchJobs(
        {
          ...base,
          page: nextPage,
          limit: listMeta.limit || 20,
        },
        { token },
      );
      setListJobs((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        const merged = [...prev];
        for (const j of res.data) {
          if (!seen.has(j.id)) {
            seen.add(j.id);
            merged.push(j);
          }
        }
        return merged;
      });
      setListMeta(res.meta);
    } catch {
      // CORS / network: leave list as-is; devtools will show the error.
    } finally {
      setLoadingMore(false);
    }
  }, [listMeta, loadingMore, canLoadMore, urlFilters, getToken]);

  const canonicalQuery = useMemo(() => {
    return urlKey ? `/jobs?${urlKey}` : "/jobs";
  }, [urlKey]);

  const savedMatch = useMemo(() => {
    const current = normalizeQueryForMatch(canonicalQuery);
    return savedSearches.find((item) => normalizeQueryForMatch(item.query) === current) ?? null;
  }, [savedSearches, canonicalQuery]);

  const canSaveAnother = savedSearches.length < 3;
  const canSaveCurrentQuery = canonicalQuery !== "/jobs";

  const onSaveSearch = useCallback(async () => {
    if (!isSignedIn) {
      const redirect = encodeURIComponent(canonicalQuery);
      router.push(`/sign-in?redirect_url=${redirect}`);
      return;
    }

    if (savedMatch) {
      return;
    }
    if (!canSaveCurrentQuery) {
      return;
    }
    if (!canSaveAnother) {
      setSavedSearchNotice("Max 3 saved searches reached");
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
      const autoName = getNextSavedSearchName(savedSearches);
      const created = await createSavedSearch(token, { query: canonicalQuery, name: autoName });
      setSavedSearches((prev) =>
        prev.some((item) => item.query === created.query) ? prev : [created, ...prev],
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "SAVED_SEARCH_LIMIT_REACHED") {
        // No toast needed; button/inline max state already reflects this.
      } else {
        setSavedSearchNotice("Could not save search");
      }
    } finally {
      setSavingSearch(false);
    }
  }, [canSaveAnother, canSaveCurrentQuery, canonicalQuery, getToken, isSignedIn, router, savedMatch, savedSearches]);

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
        rows.map((row) => (row.id === id ? { ...row, name: nextName || null } : row)),
      );
      try {
        const updated = await renameSavedSearch(token, id, nextName || null);
        setSavedSearches((rows) => rows.map((row) => (row.id === id ? updated : row)));
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

  return (
    <div className="flex min-h-screen flex-col">
      <Container width="jobs" className="mb-10 mt-2">
        <motion.header id="section-hero" className="text-center" style={{ opacity: heroOpacity, y: heroY }}>
          <h1 className="mx-auto max-w-full whitespace-nowrap font-sans text-[clamp(1.85rem,4.8vw,3.35rem)] font-semibold leading-[1.15] tracking-tight text-ink">
            <span className="font-bold text-ink">
              {splitCharacters(HERO_LEAD).map((char, index) => (
                <motion.span
                  key={`hero-lead-${index}-${char}`}
                  className="inline-block"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.015 }}
                >
                  {char === " " ? "\u00A0" : char}
                </motion.span>
              ))}
            </span>
            <span className="font-display italic text-transparent">
              <span className="bg-gradient-to-r from-teal via-rose to-brand bg-clip-text">
                {splitCharacters(HERO_ACCENT).map((char, index) => (
                  <motion.span
                    key={`hero-accent-${index}-${char}`}
                    className="inline-block"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 + index * 0.02 }}
                  >
                    {char === " " ? "\u00A0" : char}
                  </motion.span>
                ))}
              </span>
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-center text-base leading-relaxed text-ink/50 sm:text-lg">
            Aggregated from real career pages. Deduplicated. No spam.
          </p>
        </motion.header>
      </Container>

      <div
        id="section-filters"
        className="sticky top-12 z-[90] bg-canvas/95 py-3 backdrop-blur-sm sm:py-4"
      >
        <Container width="jobs" className="rounded-none bg-canvas pb-1 pt-1 shadow-sm">
          <JobsInlineFilters
            draft={draft}
            appliedFilters={urlFilters}
            setDraft={setDraft}
            uiFilters={uiFilters}
            setUiFilters={setUiFilters}
            onApply={onApply}
            onRemoveChip={onRemoveChip}
            onSortNavigate={onSortNavigate}
            showSort={false}
            showChips={false}
            totalRoles={listMeta?.total}
            selectedCategory={urlFilters.category}
            onCategoryNavigate={(category) =>
              navigate({
                ...urlFilters,
                category,
                page: undefined,
                offset: undefined,
              })
            }
          />
          <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Button
                variant={savedMatch ? "primary" : "outline"}
                size="sm"
                onClick={() => void onSaveSearch()}
                disabled={savingSearch || savedMatch != null || !canSaveCurrentQuery}
                title={!canSaveAnother ? "Only 3 saved searches allowed" : undefined}
              >
                {savedMatch ? "Saved ✓" : savingSearch ? "Saving…" : "Save search"}
              </Button>
              {savedSearches.map((saved) => {
                const details = buildSavedSearchDetails(saved.query);
                const isActiveSaved = normalizeQueryForMatch(saved.query) === normalizeQueryForMatch(canonicalQuery);
                const displayName = saved.name?.trim() || "Saved search";
                const isPopoverOpen = hoveredSavedId === saved.id || editingSavedId === saved.id;
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
                        setHoveredSavedId((prev) => (prev === saved.id ? null : prev));
                      }, 180);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => router.push(saved.query)}
                      aria-current={isActiveSaved ? "page" : undefined}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        isActiveSaved
                          ? "border-brand bg-brand/10 text-brand shadow-sm"
                          : "border-ink/15 bg-surface text-ink hover:border-brand/30 hover:text-brand"
                      }`}
                      title={displayName}
                    >
                      {displayName}
                    </button>
                    <div
                      className={`absolute left-1/2 top-full z-20 mt-1.5 w-72 -translate-x-1/2 rounded-md bg-ink p-2 text-[11px] text-white shadow transition ${
                        isPopoverOpen
                          ? "pointer-events-auto opacity-100"
                          : "pointer-events-none opacity-0"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 font-semibold text-white/95">{displayName}</p>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded px-1 text-white/90 hover:bg-white/15"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onStartRenameSavedSearch(saved);
                            }}
                            aria-label="Rename saved search"
                            title="Rename saved search"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="rounded px-1 text-white/90 hover:bg-white/15"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDeleteSavedSearch(saved.id);
                            }}
                            disabled={deletingSavedId === saved.id}
                            aria-label="Delete saved search"
                            title="Delete saved search"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                      {editingSavedId === saved.id ? (
                        <div className="pointer-events-auto mt-2 flex items-center gap-2">
                          <input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="h-7 w-full rounded border border-white/25 bg-white/10 px-2 text-[11px] text-white placeholder:text-white/55"
                            placeholder="Saved search name"
                            maxLength={80}
                          />
                          <button
                            type="button"
                            className="rounded bg-white/15 px-2 py-1 hover:bg-white/25"
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
                        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
                          {details.map((row) => (
                            <p key={`${saved.id}-${row.label}`} className="text-white/85">
                              <span className="font-semibold text-white">{row.label}:</span> {row.value}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-white/75">No filters</p>
                      )}
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
              <Link href="/saved-searches" className="text-sm font-medium text-brand hover:underline">
                View saved searches
              </Link>
            </div>
            <div className="min-w-[220px]">
              <SortSegmented
                value={urlFilters.sort === "salary_desc" ? "salary_desc" : "latest"}
                onChange={(v) => onSortNavigate(v === "salary_desc" ? "salary_desc" : undefined)}
                totalRoles={listMeta?.total}
              />
            </div>
          </div>
          {savedSearchNotice ? (
            <p className="mb-2 text-xs text-ink-muted" role="status">
              {savedSearchNotice}
            </p>
          ) : null}
          <FilterChips filters={urlFilters} onRemoveChip={onRemoveChip} />
        </Container>
      </div>

      <Container width="jobs" className="mt-8">
        {(() => {
          const totalMatches = listMeta?.total ?? 0;
          const noMatches = listJobs.length === 0 && totalMatches === 0;
          const showCapWall = Boolean(
            listMeta?.capReached && listMeta.resetAt && !noMatches,
          );
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
                  uiFilters.location || urlFilters.location || (urlFilters.locations?.length ?? 0) > 0
                    ? () => {
                        setUiFilters((prev) => ({ ...prev, location: undefined }));
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
            showCapWall && listJobs.length > 0 ? listJobs.slice(0, 10) : listJobs;
          return (
            <>
              {listJobs.length > 0 ? <JobList jobs={jobsForList} /> : null}
              {showCapWall && capResetAt ? (
                <DailyCapWall
                  resetAt={capResetAt}
                  count={Math.max(0, listMeta?.totalHidden ?? 0)}
                  previewJobs={listJobs}
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

      <Container width="jobs" className="mt-20 border-t border-ink/10 pt-12">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">
          Related searches
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {relatedSlugs.map((slug) => (
            <Link
              key={slug}
              href={`/jobs/${slug}`}
              className="rounded-full bg-surface/90 px-4 py-2 text-sm text-ink/70 no-underline shadow-sm ring-1 ring-ink/5 transition-all hover:-translate-y-0.5 hover:text-brand hover:ring-brand/20"
            >
              {slug.replace(/-/g, " ")}
            </Link>
          ))}
        </div>
      </Container>
    </div>
  );
}
