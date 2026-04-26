"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "../../lib/cn";
import { useApplications } from "../../lib/applicationsContext";
import { signInWithNext } from "../../lib/signInUrl";

/** Collapsed width; expands on hover (inactive) or when active. */
const W_COLLAPSED = "w-[136px]";
const W_EXPANDED = "w-[186px]";

const railTab =
  "group relative flex items-center gap-2.5 overflow-hidden rounded-r-xl py-5 pl-4 pr-5 shadow-sm transition-[width,box-shadow,background-color] duration-300 ease-out";

function IconDiamondFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5 20.5 12 12 21.5 3.5 12 12 2.5z" />
    </svg>
  );
}

function IconDiamondOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2.5 20.5 12 12 21.5 3.5 12 12 2.5z" strokeLinejoin="round" />
    </svg>
  );
}

function IconSmartApply({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0 text-white opacity-95", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 011.272-.71z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconApplications({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0 text-white opacity-95", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0z" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

export function SiteSideRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const jobs = pathname.startsWith("/jobs");
  const companies = pathname.startsWith("/companies") || pathname.startsWith("/company");
  const smartApply = pathname.startsWith("/smart-apply");
  const applications = pathname.startsWith("/applications");
  const { stats } = useApplications();

  const actionCount = stats && stats.needsAction > 0 ? stats.needsAction : 0;
  const goProtected = useCallback(
    (path: string) => {
      if (!authLoaded) return;
      if (isSignedIn) {
        router.push(path);
        return;
      }
      router.push(signInWithNext(path));
    },
    [authLoaded, isSignedIn, router],
  );

  return (
    <nav
      id="sidebar-tabs"
      className="fixed left-0 top-0 z-[65] hidden h-screen flex-col justify-center gap-1.5 py-10 lg:flex"
      aria-label="Sections"
    >
      <Link
        href="/jobs"
        title="Jobs"
        prefetch={false}
        className={cn(
          railTab,
          jobs ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          jobs
            ? "bg-teal font-bold tracking-wide !text-white"
            : "bg-teal/85 font-bold tracking-wide !text-white hover:bg-teal hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <IconDiamondFilled className="h-3.5 w-3.5 shrink-0 text-white opacity-95" />
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
        prefetch={false}
        className={cn(
          railTab,
          companies ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          companies
            ? "bg-rose font-bold tracking-wide !text-white shadow-md"
            : "bg-rose/85 font-bold tracking-wide !text-white hover:bg-rose hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <IconDiamondOutline className="h-3.5 w-3.5 shrink-0 text-white opacity-95" />
        <span className="min-w-0 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Companies
        </span>
        {companies ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </Link>
      <button
        type="button"
        onClick={() => goProtected("/smart-apply")}
        title="Smart Apply"
        className={cn(
          railTab,
          smartApply ? `${W_EXPANDED} shadow-md` : `${W_COLLAPSED} hover:w-[186px] hover:shadow-md`,
          smartApply
            ? "bg-brand font-bold tracking-wide !text-white shadow-md"
            : "bg-brand/85 font-bold tracking-wide !text-white hover:bg-brand hover:!text-white active:!text-white visited:!text-white",
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <IconSmartApply />
        <span className="min-w-0 flex-1 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Smart Apply
        </span>
        {smartApply ? (
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => goProtected("/applications")}
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
        <IconApplications />
        <span className="min-w-0 flex-1 truncate text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-300 group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]">
          Applications
        </span>
        <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {actionCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-black leading-none text-white ring-1 ring-white/40"
              title={`${actionCount} need attention`}
            >
              <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 011.272-.71z"
                  clipRule="evenodd"
                />
              </svg>
              {actionCount}
            </span>
          ) : null}
          {applications ? <span className="h-1.5 w-1.5 rounded-full bg-white/60" /> : null}
        </span>
      </button>
    </nav>
  );
}
