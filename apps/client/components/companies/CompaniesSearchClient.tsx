"use client";

import { useInView } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchCompanies,
  type CompanyListItem,
  type CompaniesSort,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { signalProgrammaticNavigation } from "../layout/RouteLoader";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { Button } from "../ui/Button";
import { Input, inputBaseClass } from "../ui/Input";
import { CompanyCard } from "./CompanyCard";

const LIMIT = 24;

function parseSort(raw: string | null): CompaniesSort {
  if (raw === "recent" || raw === "name") return raw;
  return "jobs";
}

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
    };
  };
}

export function CompaniesSearchClient({ initialCompanies, initialMeta }: Props) {
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [list, setList] = useState<CompanyListItem[]>(initialCompanies);
  const [meta, setMeta] = useState(initialMeta);
  const [listHydrating, setListHydrating] = useState(initialCompanies.length === 0);
  const [listDegraded, setListDegraded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draftQ, setDraftQ] = useState(() => searchParams.get("q") ?? "");

  const q = searchParams.get("q") ?? "";
  const sort = parseSort(searchParams.get("sort"));
  const hiring =
    searchParams.get("hiring") === "true" || searchParams.get("hiring") === "1";
  const remote =
    searchParams.get("remote") === "true" || searchParams.get("remote") === "1";

  const proOnlyCompaniesParams =
    sort !== "jobs" || hiring || remote;

  const loadCompanies = useCallback(async () => {
    setListHydrating(true);
    setListDegraded(false);
    try {
      const res = await fetchCompanies({
        page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1),
        limit: LIMIT,
        q: q.trim() || undefined,
        sort,
        hiring: hiring || undefined,
        remote: remote || undefined,
      });
      setList(res.data);
      setMeta(res.meta);
    } catch {
      setList([]);
      setMeta((m) => ({ ...m, total: 0, hasMore: false }));
      setListDegraded(true);
    } finally {
      setListHydrating(false);
    }
  }, [q, sort, hiring, remote, searchParams]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  /** Free tier: sort / hiring / remote filters are Pro-only; normalize URL and list. */
  useEffect(() => {
    if (!planLoaded || isPro) return;
    if (!proOnlyCompaniesParams) return;
    let cancelled = false;
    void (async () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      const nextPath = p.toString() ? `/companies?${p}` : "/companies";
      router.replace(nextPath);
      const res = await fetchCompanies({
        page: 1,
        limit: LIMIT,
        q: q.trim() || undefined,
        sort: "jobs",
        hiring: undefined,
        remote: undefined,
      });
      if (cancelled) return;
      setList(res.data);
      setMeta(res.meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [planLoaded, isPro, q, proOnlyCompaniesParams, router]);

  useEffect(() => {
    setDraftQ(q);
  }, [q]);

  useEffect(() => {
    setList(initialCompanies);
    setMeta(initialMeta);
  }, [initialCompanies, initialMeta]);

  const navigate = useCallback(
    (next: {
      q?: string;
      sort?: CompaniesSort;
      hiring?: boolean;
      remote?: boolean;
    }) => {
      const nq = next.q !== undefined ? next.q : q;
      const ns = next.sort !== undefined ? next.sort : sort;
      const nh = next.hiring !== undefined ? next.hiring : hiring;
      const nr = next.remote !== undefined ? next.remote : remote;
      const p = new URLSearchParams();
      if (nq.trim()) p.set("q", nq.trim());
      if (ns !== "jobs") p.set("sort", ns);
      if (nh) p.set("hiring", "true");
      if (nr) p.set("remote", "true");
      const qs = p.toString();
      const href = qs ? `/companies?${qs}` : "/companies";
      signalProgrammaticNavigation(href);
      router.push(href);
    },
    [q, sort, hiring, remote, router],
  );

  const canLoadMore =
    meta.hasMore === true ||
    (meta.totalPages != null && meta.page < meta.totalPages);

  const onLoadMore = useCallback(async () => {
    if (!canLoadMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = meta.page + 1;
      const res = await fetchCompanies({
        page: nextPage,
        limit: meta.limit || LIMIT,
        q: q || undefined,
        sort,
        hiring: hiring || undefined,
        remote: remote || undefined,
      });
      setList((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const merged = [...prev];
        for (const c of res.data) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            merged.push(c);
          }
        }
        return merged;
      });
      setMeta((m) => ({
        ...res.meta,
        stats: res.meta.stats ?? m.stats,
      }));
    } finally {
      setLoadingMore(false);
    }
  }, [canLoadMore, loadingMore, meta, q, sort, hiring, remote]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sentinelRef, { amount: 0, margin: "240px" });

  useEffect(() => {
    if (inView && canLoadMore && !loadingMore) void onLoadMore();
  }, [inView, canLoadMore, loadingMore, onLoadMore]);

  const stats = meta.stats;
  const formattedTotal = useMemo(
    () =>
      stats
        ? new Intl.NumberFormat("en-US").format(stats.totalTracked)
        : null,
    [stats],
  );
  const formattedWeek = useMemo(
    () =>
      stats
        ? new Intl.NumberFormat("en-US").format(stats.hiringThisWeek)
        : null,
    [stats],
  );

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ q: draftQ });
  };

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <header>
          <h1 className="font-display text-3xl font-normal italic text-ink">
            Companies
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Discover employers, explore career pages, and jump into open roles.
          </p>
          {formattedTotal != null && formattedWeek != null ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-ink/10 bg-surface px-3 py-1 text-xs font-medium text-ink/70 shadow-sm">
                {formattedTotal} companies tracked
              </span>
              <span className="inline-flex rounded-full border border-ink/10 bg-surface px-3 py-1 text-xs font-medium text-ink/70 shadow-sm">
                {formattedWeek} hiring this week
              </span>
            </div>
          ) : null}
        </header>

        <div
          className={cn(
            "mt-6 rounded-2xl border border-ink/10 bg-surface/80 p-4 shadow-card",
            "flex flex-col gap-4",
            "md:flex-row md:flex-wrap md:items-end md:gap-x-3 md:gap-y-3",
          )}
        >
          <form
            onSubmit={onSubmitSearch}
            className={cn(
              "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:gap-3",
              "md:min-w-0 md:flex-1",
            )}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
              <span className="font-semibold leading-none text-ink">Search</span>
              <Input
                type="search"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Search companies..."
                autoComplete="off"
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full shrink-0 sm:w-auto"
            >
              Search
            </Button>
          </form>

          <label
            className={cn(
              "flex w-full flex-col gap-1.5 text-sm",
              "md:w-44 md:shrink-0",
              !isPro && "cursor-not-allowed",
            )}
            title={!isPro ? "Pro only" : undefined}
          >
            <span className="flex flex-wrap items-center gap-2 leading-none">
              <span className="font-semibold text-ink">Sort</span>
              {!isPro ? (
                <span className="rounded-md border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                  Pro only
                </span>
              ) : null}
            </span>
            <select
              className={cn(
                inputBaseClass,
                "h-10 !py-0 leading-snug",
                "w-full text-sm tabular-nums",
                isPro ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              )}
              value={sort}
              disabled={!isPro}
              title={!isPro ? "Pro only" : undefined}
              onChange={(e) =>
                navigate({ sort: e.target.value as CompaniesSort })
              }
              aria-label="Sort companies"
              aria-disabled={!isPro}
            >
              <option value="jobs">Most jobs</option>
              <option value="recent">Recently active</option>
              <option value="name">Alphabetical</option>
            </select>
          </label>

          <div
            className={cn(
              "flex w-full min-w-0 flex-col gap-1.5 text-sm",
              "md:min-w-0 md:flex-1",
              !isPro && "cursor-not-allowed",
            )}
            title={!isPro ? "Pro only" : undefined}
          >
            <span className="flex flex-wrap items-center gap-2 leading-none">
              <span className="font-semibold text-ink">Filters</span>
              {!isPro ? (
                <span className="rounded-md border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                  Pro only
                </span>
              ) : null}
            </span>
            <div className="flex flex-wrap gap-2">
              {!isPro ? (
                <span
                  title="Pro only"
                  className="inline-flex cursor-not-allowed rounded-full"
                >
                  <button
                    type="button"
                    disabled
                    tabIndex={-1}
                    className={cn(
                      "pointer-events-none inline-flex h-10 min-h-[2.5rem] shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold opacity-60",
                      "border-ink/15 bg-surface text-ink/60 ring-1 ring-ink/5",
                    )}
                  >
                    Hiring now
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate({ hiring: !hiring })}
                  className={cn(
                    "inline-flex h-10 min-h-[2.5rem] shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-colors",
                    hiring
                      ? "border-brand bg-brand/10 text-brand shadow-sm"
                      : "border-ink/15 bg-surface text-ink/80 ring-1 ring-ink/5 hover:border-ink/25 hover:bg-ink/[0.03]",
                  )}
                >
                  Hiring now
                </button>
              )}
              {!isPro ? (
                <span
                  title="Pro only"
                  className="inline-flex cursor-not-allowed rounded-full"
                >
                  <button
                    type="button"
                    disabled
                    tabIndex={-1}
                    className={cn(
                      "pointer-events-none inline-flex h-10 min-h-[2.5rem] shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold opacity-60",
                      "border-ink/15 bg-surface text-ink/60 ring-1 ring-ink/5",
                    )}
                  >
                    Remote friendly
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate({ remote: !remote })}
                  className={cn(
                    "inline-flex h-10 min-h-[2.5rem] shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-colors",
                    remote
                      ? "border-brand bg-brand/10 text-brand shadow-sm"
                      : "border-ink/15 bg-surface text-ink/80 ring-1 ring-ink/5 hover:border-ink/25 hover:bg-ink/[0.03]",
                  )}
                >
                  Remote friendly
                </button>
              )}
            </div>
          </div>
        </div>

        {listHydrating ? (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-2xl border border-ink/10 bg-ink/[0.06]"
              />
            ))}
          </div>
        ) : listDegraded ? (
          <div
            className="mt-10 rounded-2xl border border-dashed border-brand/25 bg-surface px-6 py-14 text-center"
            role="status"
          >
            <p className="text-base font-medium text-ink">Companies are loading slowly</p>
            <p className="mt-2 text-sm text-ink-muted">
              The database is busy right now. Wait a moment and try again.
            </p>
            <Button type="button" className="mt-4" onClick={() => void loadCompanies()}>
              Retry
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div
            className="mt-10 rounded-2xl border border-dashed border-ink/15 bg-surface px-6 py-14 text-center"
            role="status"
          >
            <p className="text-base font-medium text-ink">No companies found</p>
            <p className="mt-2 text-sm text-ink-muted">
              Try a different search or explore trending companies.
            </p>
          </div>
        ) : (
          <>
            <section
              className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              aria-label="Companies"
            >
              {list.map((c) => (
                <CompanyCard
                  key={c.id}
                  company={c}
                  suppressHiringBadge={hiring}
                  suppressRemoteBadge={remote}
                />
              ))}
            </section>

            {canLoadMore ? (
              <div
                ref={sentinelRef}
                className="mt-8 flex flex-col items-center gap-3 pb-4"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={loadingMore}
                  onClick={() => void onLoadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}

        <section className="mt-16 border-t border-ink/10 pt-10">
          <h2 className="font-display text-xl font-normal italic text-ink">
            Explore companies hiring right now
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/80">
            Browse companies actively hiring across engineering, product, design, and more.
            Discover verified company career pages, explore open roles, and apply early.
            Whether you are looking for{" "}
            <span className="text-ink">companies hiring now</span>,{" "}
            <span className="text-ink">tech companies careers</span>,{" "}
            <span className="text-ink">remote companies hiring</span>, or{" "}
            <span className="text-ink">startup jobs companies</span>, start from the{" "}
            <Link
              href="/jobs"
              className="font-medium text-brand no-underline hover:underline"
            >
              job listings
            </Link>{" "}
            or filter to{" "}
            <Link
              href="/jobs?remote=true"
              className="font-medium text-brand no-underline hover:underline"
            >
              remote roles
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
