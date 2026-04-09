"use client";

import Link from "next/link";
import type { JobCompany } from "../../lib/api";
import { companyLogoSrcForDisplay } from "../../lib/logoDisplay";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface Props {
  company: JobCompany;
}

export function CompanyCard({ company }: Props) {
  const logo = company.logoUrl?.trim();
  const initial = company.name.slice(0, 1).toUpperCase();
  const domain = company.domain?.trim();
  const websiteHref = domain
    ? /^https?:\/\//i.test(domain)
      ? domain
      : `https://${domain}`
    : company.careerPage?.trim() || null;

  return (
    <Card accent="teal" as="div" className="p-5">
      <div className="flex items-start gap-3">
        {logo ? (
          <div className="relative h-11 w-11 shrink-0">
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
              className="absolute inset-0 h-full w-full rounded-lg object-contain ring-1 ring-ink/10"
            />
            <div
              style={{ display: "none" }}
              className="absolute inset-0 flex items-center justify-center rounded-lg bg-teal-soft font-black text-teal ring-1 ring-ink/10"
              aria-hidden
            >
              {initial}
            </div>
          </div>
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-soft font-black text-teal ring-1 ring-ink/10">
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <Link href={`/company/${company.slug}`} className="truncate text-base font-extrabold text-ink no-underline hover:text-brand">
            {company.name}
          </Link>
          {websiteHref && domain ? (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-ink/50 no-underline hover:text-brand hover:underline"
            >
              {domain}
            </a>
          ) : (
            <p className="text-xs text-ink/50">Domain unavailable</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <p className="text-ink/70">
          Open roles: <span className="font-bold text-ink">{company.openRoles ?? 0}</span>
        </p>
        {company.careerPage ? (
          <Button
            variant="outline"
            outlineTone="teal"
            size="sm"
            href={company.careerPage}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full"
          >
            Careers page ↗
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
