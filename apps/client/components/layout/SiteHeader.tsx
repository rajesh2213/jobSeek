import Link from "next/link";

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
      <div className="flex h-16 items-center justify-between bg-canvas px-4 sm:px-6">
        <div className="pointer-events-auto flex min-w-0 items-center gap-3 sm:gap-4">
          <Link
            href="/jobs"
            className="group relative z-[80] flex shrink-0 items-baseline gap-1 no-underline transition-transform duration-200 hover:scale-[1.02]"
          >
            <span className="font-display text-2xl italic text-ink transition-colors group-hover:text-brand sm:text-3xl">
              jobseek
            </span>
            <span className="mb-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand transition-all group-hover:shadow-[0_0_0_6px_rgba(234,88,12,0.16)]" aria-hidden />
          </Link>
          <nav
            className="hidden min-w-0 items-center gap-3 text-xs font-bold uppercase tracking-wide text-ink/50 min-[420px]:flex lg:hidden"
            aria-label="Sections"
          >
            <Link href="/jobs" className="no-underline hover:text-brand">
              Jobs
            </Link>
            <Link href="/companies" className="no-underline hover:text-brand">
              Companies
            </Link>
          </nav>
        </div>
        {/* Space reserved for `FixedAccountAvatar` in root layout (same visual slot) */}
        <div className="h-11 w-11 shrink-0" aria-hidden />
      </div>
    </header>
  );
}
