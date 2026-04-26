"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useMemo } from "react";
import type { JobItem } from "../../lib/api";
import { accentFromId } from "../../lib/accent";
import { formatSalaryUsd, formatTimeAgo } from "../../lib/format";
import { filterSkillPillsForDisplay, jobCardPinLocationText } from "../../lib/jobDisplay";
import { cn } from "../../lib/cn";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { useNowTicker } from "../../lib/useNowTicker";
import { Badge } from "../ui/Badge";
import { buttonClassName } from "../ui/Button";
import { ApplyJobButton } from "./ApplyJobButton";
import { AppliedToggleButton } from "./AppliedToggleButton";
import { Card } from "../ui/Card";
import { WorkTypeOutlinePill } from "./WorkTypeOutlinePill";

const ResumeScorePill = dynamic(
  () =>
    import("../resume/ResumeScorePill").then((m) => ({ default: m.ResumeScorePill })),
  {
    ssr: true,
    loading: () => (
      <div
        className="h-9 w-full min-w-[10rem] shrink-0 animate-pulse rounded-lg bg-ink/10"
        aria-hidden
      />
    ),
  },
);

/** Roles first seen or posted within this window show the NEW badge. */
const NEW_JOB_MAX_MS = 10 * 60 * 60 * 1000;
/** Stronger “Just posted” pulse for very fresh listings. */
const JUST_POSTED_MAX_MS = 90 * 60 * 1000;

function isJustPosted(job: JobItem): boolean {
  const raw = job.postedAt?.trim() || job.createdAt;
  if (!raw || raw === "null") return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < JUST_POSTED_MAX_MS;
}

function isNewJob(job: JobItem): boolean {
  const hasPosted =
    job.postedAt != null && String(job.postedAt).trim() !== "" && job.postedAt !== "null";
  const iso = hasPosted ? job.postedAt : job.createdAt;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < NEW_JOB_MAX_MS;
}

function postedMetaLine(job: JobItem): string {
  const raw = formatTimeAgo(job.postedAt, job.createdAt).replace(/\*$/, "");
  if (raw === "Recently posted") return raw;
  return `Posted ${raw}`;
}

interface Props {
  job: JobItem;
  /** Dense card for similar-jobs grid (no excerpt, max 3 skill tags). */
  compact?: boolean;
  flashAppliedJobId?: string | null;
}

function JobCardComponent({ job, compact, flashAppliedJobId }: Props) {
  /** Compact cards skip the global minute ticker to cut re-renders; relative time still correct on mount. */
  const tick = useNowTicker(!compact);

  const postedLabel = useMemo(
    () => postedMetaLine(job),
    [job.postedAt, job.createdAt, tick],
  );
  const showNew = isNewJob(job);
  const justPosted = isJustPosted(job);
  const showNewBadge = showNew && !justPosted;
  const accent = accentFromId(job.id);
  const skillPool = filterSkillPillsForDisplay(job.skills);
  const tags = skillPool.slice(0, 4);
  const skillMore = skillPool.length - tags.length;
  const applyHref = job.applyUrl?.trim() || job.sourceUrl;
  const descFallback =
    job.description?.trim() ||
    "Details open on the company careers site when you apply.";
  const previewLines =
    job.previewLines && job.previewLines.length > 0
      ? job.previewLines
      : [descFallback.length > 220 ? `${descFallback.slice(0, 220)}…` : descFallback];
  const previewFromResponsibility = job.previewLinesSource === "responsibility";
  const hasSalary = job.salaryMin != null && job.salaryMin > 0;
  const isAppliedFlash = flashAppliedJobId === job.id;
  const logo = job.company.logoUrl?.trim();
  const initial = job.company.name.slice(0, 1).toUpperCase();
  const locationText = jobCardPinLocationText(job);
  const showLocation = locationText !== "Location TBD";
  const titleHover =
    accent === "teal"
      ? "group-hover:text-teal"
      : accent === "rose"
        ? "group-hover:text-rose"
        : accent === "amber"
          ? "group-hover:text-amber"
          : "group-hover:text-brand";

  const cardHoverClass = cn(
    "will-change-transform",
    "hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)]",
  );
  const motionLiteClass = "transition-transform duration-150 ease-out hover:scale-[1.01]";

  const justPostedBadge = justPosted ? (
    <span className="rounded-full bg-emerald-500/14 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-500/25 dark:text-emerald-100">
      Just posted
    </span>
  ) : null;

  const newBadge = showNewBadge ? (
    <span className="rounded-full bg-brand px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md ring-2 ring-brand/90 ring-offset-2 ring-offset-surface">
      NEW
    </span>
  ) : null;

  if (compact) {
    return (
      <div
        className={cn("h-full", motionLiteClass)}
      >
      <Card
        accent={accent}
        className={cn(
          "h-full !p-4 transition-all duration-300",
          cardHoverClass,
          isAppliedFlash && "ring-2 ring-teal/45 bg-teal-soft/40",
        )}
      >
        <div className="flex h-full min-h-0 flex-col justify-between gap-3">
          <div className="min-w-0">
            <div className="flex gap-3">
              {logo ? (
                <div className="relative h-10 w-10 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external company logos */}
                  <img
                    src={companyLogoSrcForDisplay(logo)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const el = e.currentTarget.nextElementSibling as HTMLElement | null;
                      el?.removeAttribute("style");
                    }}
                    className="absolute inset-0 h-full w-full rounded-lg bg-teal-soft object-contain ring-1 ring-ink/5"
                  />
                  <div
                    style={{ display: "none" }}
                    className={cn(
                      "absolute inset-0 flex items-center justify-center rounded-lg text-sm font-black ring-1 ring-ink/5",
                      accent === "teal" && "bg-teal-soft text-teal",
                      accent === "rose" && "bg-rose-soft text-rose",
                      accent === "amber" && "bg-amber-soft text-amber",
                      accent === "brand" && "bg-brand/10 text-brand",
                    )}
                    aria-hidden
                  >
                    {initial}
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-black ring-1 ring-ink/5",
                    accent === "teal" && "bg-teal-soft text-teal",
                    accent === "rose" && "bg-rose-soft text-rose",
                    accent === "amber" && "bg-amber-soft text-amber",
                    accent === "brand" && "bg-brand/10 text-brand",
                  )}
                  aria-hidden
                >
                  {initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">
                    {postedLabel}
                  </span>
                  {justPostedBadge}
                  {showNewBadge ? newBadge : null}
                </div>
                <Link
                  href={`/job/${job.id}`}
                  className={cn(
                    "line-clamp-2 block text-lg font-semibold leading-snug tracking-tight text-ink no-underline transition-colors",
                    titleHover,
                  )}
                >
                  {job.title}
                </Link>
                <p className="mt-1 text-sm text-ink-muted line-clamp-1">
                  <Link
                    href={`/company/${job.company.slug}`}
                    className="font-medium text-ink-muted no-underline hover:text-brand"
                  >
                    {job.company.name}
                  </Link>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
                  {showLocation ? <span className="min-w-0 text-black/50">📍 {locationText}</span> : null}
                  <WorkTypeOutlinePill job={job} className="shrink-0" />
                </div>
                {tags.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap items-center gap-1" aria-label="Skills">
                    {tags.map((s) => (
                      <li key={s}>
                        <Badge tone="rose" caps={false} className="text-[11px]">
                          {s.replace(/-/g, " ")}
                        </Badge>
                      </li>
                    ))}
                    {skillMore > 0 ? (
                      <li className="text-[11px] font-semibold text-ink/45">+{skillMore} more</li>
                    ) : null}
                  </ul>
                ) : null}
                {hasSalary ? (
                  <p className="mt-2 text-xs font-semibold tabular-nums text-ink/70">
                    From {formatSalaryUsd(job.salaryMin!)}/yr
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-ink/5 pt-3">
            <ApplyJobButton
              jobId={job.id}
              applyUrl={applyHref}
              outlineTone={accent}
              size="sm"
              variant="outline"
            />
            <AppliedToggleButton
              jobId={job.id}
              outlineTone={accent}
              size="sm"
            />
            <Link
              href={`/job/${job.id}`}
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              View role
            </Link>
          </div>
        </div>
      </Card>
      </div>
    );
  }

  return (
    <div
      className={cn("h-full", motionLiteClass)}
    >
    <Card
      accent={accent}
      className={cn("h-full transition-shadow", cardHoverClass, isAppliedFlash && "ring-2 ring-teal/45 bg-teal-soft/35")}
    >
      <div className="relative z-0 flex items-start gap-5">
        <div className="absolute right-6 top-6 z-10 flex max-w-[min(100%,calc(100%-1rem))] min-w-0 flex-col gap-2">
          <div className="flex flex-nowrap justify-end gap-2">
            <ApplyJobButton
              jobId={job.id}
              applyUrl={applyHref}
              outlineTone={accent}
              size="sm"
              variant="outline"
              className="shrink-0"
            />
            <AppliedToggleButton
              jobId={job.id}
              outlineTone={accent}
              size="sm"
              className="shrink-0"
            />
            <Link
              href={`/job/${job.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonClassName({ variant: "primary", size: "sm" }), "shrink-0")}
            >
              View role →
            </Link>
          </div>
          <div className="w-full min-w-0">
            <ResumeScorePill job={job} />
          </div>
        </div>
        {logo ? (
          <div className="relative h-12 w-12 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- external company logos */}
            <img
              src={companyLogoSrcForDisplay(logo)}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const el = e.currentTarget.nextElementSibling as HTMLElement | null;
                el?.removeAttribute("style");
              }}
              className="absolute inset-0 h-full w-full rounded-xl bg-teal-soft object-contain ring-1 ring-ink/5 transition-colors group-hover:bg-teal/20"
            />
            <div
              style={{ display: "none" }}
              className={`absolute inset-0 flex items-center justify-center rounded-xl text-base font-black ring-1 ring-ink/5 transition-colors ${
                accent === "teal"
                  ? "bg-teal-soft text-teal group-hover:bg-teal/20"
                  : accent === "rose"
                    ? "bg-rose-soft text-rose group-hover:bg-rose/20"
                    : accent === "amber"
                      ? "bg-amber-soft text-amber group-hover:bg-amber/20"
                      : "bg-brand/10 text-brand group-hover:bg-brand/20"
              }`}
              aria-hidden
            >
              {initial}
            </div>
          </div>
        ) : (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-black ring-1 ring-ink/5 transition-colors ${
              accent === "teal"
                ? "bg-teal-soft text-teal group-hover:bg-teal/20"
                : accent === "rose"
                  ? "bg-rose-soft text-rose group-hover:bg-rose/20"
                  : accent === "amber"
                    ? "bg-amber-soft text-amber group-hover:bg-amber/20"
                    : "bg-brand/10 text-brand group-hover:bg-brand/20"
            }`}
            aria-hidden
          >
            {initial}
          </div>
        )}
        <div className="relative min-w-0 flex-1 pr-[13.5rem] sm:pr-56">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">
              {postedLabel}
            </span>
            {justPostedBadge}
            {showNewBadge ? newBadge : null}
          </div>

          <h3 className="mb-2 text-lg font-extrabold leading-snug tracking-tight text-ink">
            <Link
              href={`/job/${job.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`no-underline transition-colors ${titleHover} text-ink`}
            >
              {job.title}
            </Link>
          </h3>

          <p className="mb-2 text-sm font-medium text-ink/55">
            <Link
              href={`/company/${job.company.slug}`}
              className="font-bold text-ink/75 no-underline hover:text-brand"
            >
              {job.company.name}
            </Link>
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
            {showLocation ? <span className="min-w-0 text-black/50">📍 {locationText}</span> : null}
            <WorkTypeOutlinePill job={job} className="shrink-0" />
          </div>

          {hasSalary && (
            <div className="mb-4 inline-flex flex-col rounded-2xl bg-brand/10 px-5 py-3 ring-1 ring-brand/20">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand">From</span>
              <span className="text-xl font-extrabold tabular-nums text-ink">
                {formatSalaryUsd(job.salaryMin!)}
              </span>
              <span className="text-xs font-medium text-ink/50">per year</span>
            </div>
          )}

          {tags.length > 0 ? (
            <ul className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Skills">
              {tags.map((s) => (
                <li key={s}>
                  <Badge tone="rose" caps={false}>
                    {s.replace(/-/g, " ")}
                  </Badge>
                </li>
              ))}
              {skillMore > 0 ? (
                <li className="text-xs font-semibold text-ink/45">+{skillMore} more</li>
              ) : null}
            </ul>
          ) : null}

          <p
            className="mb-3 line-clamp-2 whitespace-pre-line text-[13px] leading-[1.5] text-black/45"
            aria-label="Role preview"
          >
            {previewLines
              .slice(0, 2)
              .map((line) => (previewFromResponsibility ? `↳ ${line}` : line))
              .join("\n")}
          </p>
        </div>
      </div>
    </Card>
    </div>
  );
}

export const JobCard = memo(JobCardComponent);
JobCard.displayName = "JobCard";
