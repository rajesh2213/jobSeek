"use client";

import Link from "next/link";
import { siteLogoBrandDotRef } from "../../lib/siteLogoBrandDotRef";
import { SiteSideRailMobileNav } from "./SiteSideRail";

/**
 * Sticky top bar. Account avatar lives in root layout (`FixedAccountAvatar`) so it is not
 * trapped in this header’s stacking context (`isolate` + sticky).
 */
export function SiteHeader() {
  return (
    <header
      className="pointer-events-none sticky top-0 z-[70] isolate w-full bg-canvas shadow-none"
      id="header-topbar"
    >
      <div className="pointer-events-auto flex h-14 w-full items-center justify-between gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-3 sm:gap-4">
          <Link
            id="site-logo-link"
            href="/"
            prefetch={false}
            className="group relative z-[80] flex shrink-0 items-baseline gap-1 no-underline transition-transform duration-200 hover:scale-[1.02]"
          >
            <span className="font-display text-2xl italic text-ink transition-colors group-hover:text-brand sm:text-3xl">
              jobloom
            </span>
            <span
              ref={siteLogoBrandDotRef}
              id="site-logo-brand-dot"
              className="mb-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand transition-all group-hover:shadow-[0_0_0_6px_rgba(234,88,12,0.16)]"
              aria-hidden
            />
          </Link>
          <nav className="hidden min-w-0 items-center gap-3 text-xs font-bold uppercase tracking-wide text-ink/50" aria-label="Sections">
            <Link href="/jobs" prefetch={false} className="no-underline hover:text-brand">
              Jobs
            </Link>
            <Link href="/companies" prefetch={false} className="no-underline hover:text-brand">
              Companies
            </Link>
          </nav>
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-1 lg:hidden">
          <SiteSideRailMobileNav />
        </div>
        {/* Roughly balances FixedAccountAvatar so pills stay visually centered */}
        <div className="pointer-events-none invisible flex w-11 shrink-0 justify-end sm:w-[132px]" aria-hidden>
          <span className="inline-block h-11 w-11 opacity-0" />
        </div>
      </div>
    </header>
  );
}
