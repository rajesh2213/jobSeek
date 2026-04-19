"use client";

import Link from "next/link";
import { SiteLogoHeaderLink } from "../brand/SiteLogoHeaderLink";

/**
 * Sticky top bar. Account avatar lives in root layout (`FixedAccountAvatar`) so it is not
 * trapped in this header’s stacking context (`isolate` + sticky).
 */
export function SiteHeader() {
  return (
    <header
      className="pointer-events-none sticky top-0 z-[70] isolate border-none shadow-none"
      id="header-topbar"
    >
      <div className="flex h-16 items-center bg-canvas px-4 sm:px-6">
        <div className="pointer-events-auto flex min-w-0 items-center gap-3 sm:gap-4">
          <SiteLogoHeaderLink />
          <nav
            className="hidden min-w-0 items-center gap-3 text-xs font-bold uppercase tracking-wide text-ink/50 min-[420px]:flex lg:hidden"
            aria-label="Sections"
          >
            <Link href="/jobs" prefetch={false} className="no-underline hover:text-brand">
              Jobs
            </Link>
            <Link href="/companies" prefetch={false} className="no-underline hover:text-brand">
              Companies
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
