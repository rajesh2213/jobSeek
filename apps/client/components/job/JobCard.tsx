import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { accentFromId } from "../../lib/accent";
import { formatSalaryUsd, formatTimeAgo } from "../../lib/format";
import { filterSkillPillsForDisplay, jobCardPinLocationText } from "../../lib/jobDisplay";
import { cn } from "../../lib/cn";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { Badge } from "../ui/Badge";
import { Button, buttonClassName } from "../ui/Button";
import { Card } from "../ui/Card";
import { WorkTypeOutlinePill } from "./WorkTypeOutlinePill";

interface Props {
  job: JobItem;
  /** Dense card for similar-jobs grid (no excerpt, max 3 skill tags). */
  compact?: boolean;
}

export function JobCard({ job, compact }: Props) {
  const accent = accentFromId(job.id);
  const skillPool = filterSkillPillsForDisplay(job.skills);
  const tags = skillPool.slice(0, 4);
  const skillMore = skillPool.length - tags.length;
  const posted = formatTimeAgo(job.postedAt, job.createdAt);
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
  const logo = job.company.logoUrl?.trim();
  const initial = job.company.name.slice(0, 1).toUpperCase();
  const titleHover =
    accent === "teal"
      ? "group-hover:text-teal"
      : accent === "rose"
        ? "group-hover:text-rose"
        : accent === "amber"
          ? "group-hover:text-amber"
          : "group-hover:text-brand";

  if (compact) {
    return (
      <Card
        accent={accent}
        className={cn(
          "h-full !p-4 transition-shadow duration-200 hover:shadow-md",
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
                    {posted}
                  </span>
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
                <p className="mt-2 text-[13px] leading-snug text-black/50">
                  📍 {jobCardPinLocationText(job)}
                </p>
                <div className="mt-2">
                  <WorkTypeOutlinePill job={job} />
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
            <Button
              variant="outline"
              outlineTone={accent}
              size="sm"
              href={applyHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Apply ↗
            </Button>
            <Link
              href={`/job/${job.id}`}
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              View role
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card accent={accent} className="h-full">
      <div className="relative z-0 flex items-start gap-5">
        <div className="absolute right-6 top-6 z-10 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            outlineTone={accent}
            size="sm"
            href={applyHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Apply ↗
          </Button>
          <Link
            href={`/job/${job.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({ variant: "primary", size: "sm" })}
          >
            View role
          </Link>
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
        <div className="min-w-0 flex-1 pr-44 sm:pr-48">
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">{posted}</span>
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
          <p className="mb-2 text-[13px] leading-snug text-black/50">📍 {jobCardPinLocationText(job)}</p>
          <div className="mb-4">
            <WorkTypeOutlinePill job={job} />
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
            className="mb-5 line-clamp-2 whitespace-pre-line text-[13px] leading-[1.5] text-black/45"
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
  );
}
