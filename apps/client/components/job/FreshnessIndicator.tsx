"use client";

import { memo, useMemo } from "react";
import type { JobFreshness, JobItem } from "../../lib/api";
import { formatTimeAgo } from "../../lib/format";
import { useNowTicker } from "../../lib/useNowTicker";
import { cn } from "../../lib/cn";

/** Stronger "Just posted" pulse — only legitimate for true publish dates. */
const JUST_POSTED_MAX_MS = 90 * 60 * 1000;
/** Roles freshly posted within this window show the NEW badge — only for POSTED. */
const NEW_JOB_MAX_MS = 10 * 60 * 60 * 1000;

/**
 * Read the backend `freshness` object first; fall back to the legacy fields
 * for clients pinned to an older server version. Anything else returns null
 * and the UI shows nothing rather than guessing.
 */
function resolveFreshness(job: JobItem): JobFreshness | null {
  if (job.freshness) return job.freshness;
  const ts = job.postedAt ?? job.effectivePostedAt ?? job.createdAt ?? null;
  if (!ts || ts === "null") return null;
  const source = job.postedAt && job.postedAt !== "null" ? "POSTED" : "DISCOVERED";
  return {
    source,
    label: source === "POSTED" ? "Posted" : "Added",
    timestamp: ts,
    relative: `${source === "POSTED" ? "Posted" : "Added"} ${formatTimeAgo(ts)}`,
  };
}

function timeSinceMs(timestamp: string): number {
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

/**
 * Inline freshness line: "Posted 3 hours ago" or "Added 3 hours ago".
 *
 * `liveTicker` controls whether the relative time auto-updates after mount.
 * Disable on dense cards / compact lists to cut re-renders. The text is
 * computed from the actual instant (not the server-rendered string) so it
 * stays accurate during long-lived sessions.
 */
export const FreshnessLine = memo(function FreshnessLine({
  job,
  liveTicker = true,
  className,
}: {
  job: JobItem;
  liveTicker?: boolean;
  className?: string;
}) {
  const tick = useNowTicker(liveTicker);
  const freshness = useMemo(() => resolveFreshness(job), [job.freshness, job.postedAt, job.effectivePostedAt, job.createdAt]);
  const text = useMemo(() => {
    if (!freshness) return "Recently posted";
    const suffix = formatTimeAgo(freshness.timestamp);
    if (suffix === "Recently posted") return suffix;
    return `${freshness.label} ${suffix}`;
  }, [freshness, tick]);

  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-widest text-ink/30", className)}>
      {text}
    </span>
  );
});

/**
 * "Just posted" pill — only renders for POSTED rows within the last 90 minutes.
 * DISCOVERED rows (`source === "DISCOVERED"`) never get this badge regardless
 * of how recent their discovery timestamp is; "Just posted" must mean what it
 * says.
 */
export const JustPostedBadge = memo(function JustPostedBadge({ job }: { job: JobItem }) {
  const freshness = resolveFreshness(job);
  if (!freshness || freshness.source !== "POSTED") return null;
  if (timeSinceMs(freshness.timestamp) >= JUST_POSTED_MAX_MS) return null;
  return (
    <span className="rounded-full bg-emerald-500/14 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-500/25 dark:text-emerald-100">
      Just posted
    </span>
  );
});

/**
 * "NEW" pill — only for POSTED rows within 10 hours that aren't already
 * eligible for "Just posted". DISCOVERED rows never get this badge — a job
 * we just crawled is not necessarily a "new" job, only a newly-visible one.
 */
export const NewBadge = memo(function NewBadge({ job }: { job: JobItem }) {
  const freshness = resolveFreshness(job);
  if (!freshness || freshness.source !== "POSTED") return null;
  const ageMs = timeSinceMs(freshness.timestamp);
  if (ageMs < JUST_POSTED_MAX_MS) return null;
  if (ageMs >= NEW_JOB_MAX_MS) return null;
  return (
    <span className="rounded-full bg-brand px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md ring-2 ring-brand/90 ring-offset-2 ring-offset-surface">
      NEW
    </span>
  );
});

/**
 * Combined header row used on cards: `<FreshnessLine /> <JustPostedBadge /> <NewBadge />`.
 * Wrapper exists so consumers don't have to re-create the flexbox layout.
 */
export function FreshnessHeader({
  job,
  liveTicker = true,
  className,
}: {
  job: JobItem;
  liveTicker?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <FreshnessLine job={job} liveTicker={liveTicker} />
      <JustPostedBadge job={job} />
      <NewBadge job={job} />
    </div>
  );
}
