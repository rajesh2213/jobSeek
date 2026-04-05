"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { motion, useScroll, useTransform } from "framer-motion";
import { fetchJobs, type JobItem, type JobsApiResponse } from "../../lib/api";
import {
  parseJobFiltersFromSearch,
  filtersToSearchParams,
  type JobFilters,
} from "../../lib/slug-parser";
import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
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

export function JobsSearchClient({ jobs, meta: initialMeta, relatedSlugs }: Props) {
  const { getToken } = useAuth();
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

  const navigate = useCallback(
    (f: JobFilters) => {
      const params = filtersToSearchParams(f).toString();
      router.push(params ? `/jobs?${params}` : "/jobs");
    },
    [router],
  );

  const onApply = useCallback(() => {
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
        className="sticky top-0 z-[90] py-3 sm:py-4"
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
