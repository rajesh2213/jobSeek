"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { memo } from "react";
import type { JobItem } from "../../lib/api";
import { accentFromId } from "../../lib/accent";
import { rememberFitSurface } from "../../lib/analytics/fitSurface";
import { formatSalaryUsd } from "../../lib/format";
import { jobCardPinLocationText } from "../../lib/jobDisplay";
import { cn } from "../../lib/cn";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { Card } from "../ui/Card";
import { buttonClassName } from "../ui/Button";
import { ApplyJobButton } from "./ApplyJobButton";
import { FreshnessLine } from "./FreshnessIndicator";
import { WorkTypeOutlinePill } from "./WorkTypeOutlinePill";

const ResumeScorePill = dynamic(
  () => import("../resume/ResumeScorePill").then((m) => ({ default: m.ResumeScorePill })),
  {
    ssr: true,
    loading: () => (
      <div className="h-8 w-full animate-pulse rounded-md bg-ink/8" aria-hidden />
    ),
  },
);

interface Props {
  job: JobItem;
}

function RecommendedJobCardComponent({ job }: Props) {
  const accent = accentFromId(job.id);
  const surface = "recommended_carousel" as const;
  const applyHref = job.applyUrl?.trim() || job.sourceUrl;
  const logo = job.company.logoUrl?.trim();
  const initial = job.company.name.slice(0, 1).toUpperCase();
  const locationText = jobCardPinLocationText(job);
  const hasSalary = job.salaryMin != null && job.salaryMin > 0;

  return (
    <Card
      accent={accent}
      as="article"
      className={cn(
        "!p-3.5 shadow-sm transition-shadow duration-200 hover:shadow-md",
        "flex h-full min-h-0 flex-col gap-2.5",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {logo ? (
          <div className="relative h-9 w-9 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- external company logos */}
            <img
              src={companyLogoSrcForDisplay(logo)}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-lg bg-white object-contain ring-1 ring-ink/8"
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1 ring-ink/8",
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
          <FreshnessLine
            job={job}
            liveTicker={false}
            className="text-[10px] font-semibold uppercase tracking-wide text-ink/45"
          />
          <Link
            prefetch={false}
            href={`/job/${job.id}`}
            onClick={() => rememberFitSurface(job.id, surface)}
            className="mt-0.5 line-clamp-2 block text-[15px] font-semibold leading-snug text-ink no-underline hover:text-brand"
          >
            {job.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink/55">{job.company.name}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink/50">
        {locationText ? <span className="truncate">📍 {locationText}</span> : null}
        {locationText ? <span aria-hidden>·</span> : null}
        <WorkTypeOutlinePill job={job} className="!text-[10px]" />
        {hasSalary ? (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatSalaryUsd(job.salaryMin!)}+</span>
          </>
        ) : null}
      </div>

      <div className="mt-auto space-y-2 pt-0.5">
        <ResumeScorePill job={job} surface={surface} />
        <div className="flex gap-2">
          <ApplyJobButton
            jobId={job.id}
            company={job.company.name}
            source="recommended_carousel"
            surface={surface}
            applyUrl={applyHref}
            outlineTone={accent}
            size="sm"
            variant="outline"
            className="h-8 min-h-8 flex-1 !px-2 text-[11px] font-semibold"
          />
          <Link
            prefetch={false}
            href={`/job/${job.id}`}
            onClick={() => rememberFitSurface(job.id, surface)}
            className={buttonClassName({
              variant: "primary",
              size: "sm",
              className: "h-8 min-h-8 shrink-0 !px-3 text-[11px] font-semibold",
            })}
          >
            View
          </Link>
        </div>
      </div>
    </Card>
  );
}

export const RecommendedJobCard = memo(RecommendedJobCardComponent);
RecommendedJobCard.displayName = "RecommendedJobCard";
