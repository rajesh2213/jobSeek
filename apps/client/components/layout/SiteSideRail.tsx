"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/cn";
import { useApplications } from "../../lib/applicationsContext";

/** Collapsed width; expands on hover (inactive) or when active. */
const W_COLLAPSED = "w-[136px]";
const W_EXPANDED = "w-[186px]";

const railTab =
  "group relative flex items-center gap-2.5 overflow-hidden rounded-r-xl py-5 pl-4 pr-5 shadow-sm transition-[width,box-shadow,background-color] duration-300 ease-out";

export function SiteSideRail() {
  const pathname = usePathname();
  const jobs = pathname.startsWith("/jobs");
  const companies = pathname.startsWith("/companies") || pathname.startsWith("/company");
  const applications = pathname.startsWith("/applications");
  const { stats } = useApplications();

  const actionCount = stats && stats.needsAction > 0 ? stats.needsAction : 0;

  return (
    <nav
      id="sidebar-tabs"
      className="fixed left-0 top-0 z-[65] hidden h-screen flex-col justify-center gap-1.5 py-10 lg:flex"
      aria-label="Sections"
    >
      <Link
        href="/jobs"
        title="Jobs"
        className={cn(
          railTab,
          jobs ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          jobs
            ? "bg-teal font-bold tracking-wide !text-white"
            : "bg-teal/85 font-bold tracking-wide !text-white hover:bg-teal hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          ◆
        </span>
        <span className="min-w-0 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Jobs
        </span>
        {jobs ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </Link>
      <Link
        href="/companies"
        title="Companies"
        className={cn(
          railTab,
          companies ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          companies
            ? "bg-rose font-bold tracking-wide !text-white shadow-md"
            : "bg-rose/85 font-bold tracking-wide !text-white hover:bg-rose hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          ◇
        </span>
        <span className="min-w-0 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Companies
        </span>
        {companies ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </Link>
      <Link
        href="/applications"
        title="Applications"
        className={cn(
          railTab,
          applications ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          applications
            ? "bg-amber font-bold tracking-wide !text-white shadow-md"
            : "bg-amber/85 font-bold tracking-wide !text-white hover:bg-amber hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <span className="shrink-0 text-sm opacity-90" aria-hidden>
          📋
        </span>
        <span className="min-w-0 flex-1 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Applications
        </span>
        <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {actionCount > 0 ? (
            <span
              className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-black leading-none text-white ring-1 ring-white/40"
              title={`${actionCount} need attention`}
            >
              ⚡{actionCount}
            </span>
          ) : null}
          {applications ? <span className="h-1.5 w-1.5 rounded-full bg-white/60" /> : null}
        </span>
      </Link>
    </nav>
  );
}
