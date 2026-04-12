"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CompanyListItem } from "../../lib/api";
import { accentFromId } from "../../lib/accent";
import { cn } from "../../lib/cn";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { Badge } from "../ui/Badge";

const ACCENT_GRADIENT: Record<ReturnType<typeof accentFromId>, string> = {
  teal: "from-teal/80 to-teal/50",
  rose: "from-rose/80 to-rose/50",
  amber: "from-amber/80 to-amber/50",
  brand: "from-brand/90 to-brand/60",
};

function clearbitFromDomain(domain: string | null): string | null {
  const d = domain?.trim();
  if (!d) return null;
  return `https://logo.clearbit.com/${encodeURIComponent(d)}`;
}

/** Open company site in a new tab; domain is stored as hostname only. */
function websiteUrlFromDomain(domain: string): string {
  const d = domain.trim();
  if (!d) return "#";
  const lower = d.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return d;
  return `https://${d}`;
}

interface Props {
  company: CompanyListItem;
  /** Hide badge when the same filter is already applied. */
  suppressHiringBadge?: boolean;
  suppressRemoteBadge?: boolean;
}

export function CompanyCard({
  company,
  suppressHiringBadge,
  suppressRemoteBadge,
}: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const accent = accentFromId(company.id);
  const letter = company.name.trim().charAt(0).toUpperCase() || "?";

  const logoSrc = useMemo(() => {
    const stored = company.logoUrl?.trim();
    if (stored) return companyLogoSrcForDisplay(stored);
    return clearbitFromDomain(company.domain) ?? "";
  }, [company.logoUrl, company.domain]);

  const jobCount = company.jobCount ?? 0;
  const showHiring = !suppressHiringBadge && jobCount > 0;
  const showRemote =
    !suppressRemoteBadge && company.hasRemoteJobs === true;

  const companyHref = `/company/${company.slug}`;

  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-ink/10 bg-surface p-5 shadow-card transition duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
      )}
    >
      {/* Full-card navigation; domain link below opts out via pointer-events */}
      <Link
        href={companyHref}
        className="absolute inset-0 z-0 rounded-2xl outline-none ring-offset-2 ring-offset-canvas focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-label={`${company.name} — view company`}
      >
        <span className="sr-only">View company profile</span>
      </Link>

      <div className="relative z-[1] flex flex-col gap-3 pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-white p-1 transition-transform duration-200 group-hover:scale-105">
            {!logoFailed && logoSrc ? (
              <img
                src={logoSrc}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-md bg-gradient-to-br text-sm font-bold text-white",
                  ACCENT_GRADIENT[accent],
                )}
                aria-hidden
              >
                {letter}
              </div>
            )}
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="truncate font-semibold text-ink">{company.name}</span>
            {company.domain?.trim() ? (
              <a
                href={websiteUrlFromDomain(company.domain)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "relative z-[2] truncate text-sm text-ink/50 no-underline transition-colors",
                  "pointer-events-auto hover:text-brand hover:underline",
                )}
              >
                {company.domain}
              </a>
            ) : (
              <span className="truncate text-sm text-ink/50">Domain pending</span>
            )}
          </div>
        </div>

        {(showHiring || showRemote) && (
          <div className="flex flex-wrap gap-2">
            {showHiring ? (
              <Badge tone="teal" caps={false}>
                Hiring
              </Badge>
            ) : null}
            {showRemote ? (
              <Badge tone="brand" caps={false}>
                Remote
              </Badge>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink/40">
            {jobCount === 1 ? "1 open role" : `${jobCount} open roles`}
          </span>
          <span className="shrink-0 text-sm font-medium text-brand transition-colors group-hover:underline">
            View jobs →
          </span>
        </div>
      </div>
    </div>
  );
}
