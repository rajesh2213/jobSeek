"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/cn";

/** Collapsed width; expands on hover (inactive) or when active. */
const W_COLLAPSED = "w-[136px]";
const W_EXPANDED = "w-[186px]";

const railTab =
  "group relative flex items-center gap-2.5 overflow-hidden rounded-r-xl py-5 pl-4 shadow-sm transition-[width,padding,gap,box-shadow] duration-300 ease-out";

export function SiteSideRail() {
  const pathname = usePathname();
  const jobs = pathname.startsWith("/jobs") || pathname === "/";
  const companies = pathname.startsWith("/companies") || pathname.startsWith("/company");

  return (
    <nav
      id="sidebar-tabs"
      className="fixed left-0 top-0 z-50 hidden h-screen flex-col justify-center gap-1.5 py-10 lg:flex"
      aria-label="Sections"
    >
      <Link
        href="/jobs"
        title="Jobs"
        className={cn(
          railTab,
          jobs ? `${W_EXPANDED} pr-7 shadow-md` : `${W_COLLAPSED} pr-5 hover:w-[186px] hover:gap-3 hover:pr-7 hover:shadow-md`,
          jobs
            ? "bg-teal font-bold tracking-wide text-white"
            : "bg-teal/85 font-bold tracking-wide text-white/85 hover:bg-teal hover:text-white",
        )}
      >
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          ◆
        </span>
        <span className="min-w-0 truncate text-sm tracking-wide">Jobs</span>
        {jobs ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </Link>
      <Link
        href="/companies"
        title="Companies"
        className={cn(
          railTab,
          companies ? `${W_EXPANDED} pr-7 shadow-md` : `${W_COLLAPSED} pr-5 hover:w-[186px] hover:gap-3 hover:pr-7 hover:shadow-md`,
          companies
            ? "bg-rose font-bold tracking-wide text-white shadow-md"
            : "bg-rose/85 font-bold tracking-wide text-white/85 hover:bg-rose hover:text-white",
        )}
      >
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          ◇
        </span>
        <span className="min-w-0 truncate text-sm tracking-wide">Companies</span>
        {companies ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </Link>
      <span
        className={cn(railTab, W_COLLAPSED, "cursor-not-allowed bg-amber/70 pr-5 font-bold tracking-wide text-white/70")}
        aria-disabled="true"
        title="Coming soon"
      >
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          ♥
        </span>
        <span className="min-w-0 truncate text-sm tracking-wide">Applied</span>
      </span>
    </nav>
  );
}
