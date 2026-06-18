"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "../../lib/cn";
import { useApplications } from "../../lib/applicationsContext";
import {
  APPLICATIONS_APP_PATH,
  APPLICATION_TRACKER_FEATURE_PATH,
  protectedFeatureNavDest,
  SMART_APPLY_APP_PATH,
  SMART_APPLY_FEATURE_PATH,
} from "../../lib/signInUrl";
import { signalProgrammaticNavigation } from "./RouteLoader";
import { SidebarBrowseQuotaCard } from "./SidebarBrowseQuotaCard";

/** Collapsed width (desktop rail); expands on hover/focus/active. */
const W_COLLAPSED = "w-[112px]";
const W_EXPANDED = "w-[162px]";

/** Vertical pill — expands to the right. */
const railTabVertical =
  "group relative flex shrink-0 flex-row items-center gap-2.5 overflow-hidden rounded-r-xl py-5 pl-4 pr-5 shadow-sm transition-[width,box-shadow,background-color,transform] duration-200 ease-out motion-safe:hover:-translate-y-0.5";

/** Inline header pills: fixed size; hover = solid fill from variant only (no grow / shadow pop). */
const railTabHorizontalHeader =
  "group relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-visible rounded-xl px-2.5 py-2 shadow-sm transition-[background-color,box-shadow] duration-150 ease-out";

type RailVariant = "teal" | "rose" | "brand" | "amber";

const variantClasses: Record<
  RailVariant,
  { active: string; inactive: string }
> = {
  teal: {
    active: "bg-teal font-bold tracking-wide !text-white",
    inactive:
      "bg-teal/85 font-bold tracking-wide !text-white hover:bg-teal hover:!text-white active:!text-white visited:!text-white",
  },
  rose: {
    active: "bg-rose font-bold tracking-wide !text-white shadow-md",
    inactive:
      "bg-rose/85 font-bold tracking-wide !text-white hover:bg-rose hover:!text-white active:!text-white visited:!text-white",
  },
  brand: {
    active: "bg-brand font-bold tracking-wide !text-white shadow-md",
    inactive:
      "bg-brand/85 font-bold tracking-wide !text-white hover:bg-brand hover:!text-white active:!text-white visited:!text-white",
  },
  amber: {
    active: "bg-amber font-bold tracking-wide !text-white shadow-md",
    inactive:
      "bg-amber/85 font-bold tracking-wide !text-white hover:bg-amber hover:!text-white active:!text-white visited:!text-white",
  },
};

export type SidebarItemProps = {
  itemKey: string;
  orientation: "vertical" | "horizontal";
  expanded: boolean;
  active: boolean;
  variant: RailVariant;
  label: string;
  titleAttr: string;
  icon: ReactNode;
  /** Active-route indicator dot (vertical / desktop rail only; horizontal uses `active`). */
  showActiveDot?: boolean;
  trailing?: ReactNode;
  href?: string;
  prefetch?: boolean;
  /** Used when `href` is omitted (protected routes). */
  onProtectedNavigate?: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onFocusItem: () => void;
  onBlurItem: () => void;
  onRailKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
};

export function SidebarItem({
  itemKey,
  orientation,
  expanded,
  active,
  variant,
  label,
  titleAttr,
  icon,
  showActiveDot,
  trailing,
  href,
  prefetch = false,
  onProtectedNavigate,
  onEnter,
  onLeave,
  onFocusItem,
  onBlurItem,
  onRailKeyDown,
}: SidebarItemProps) {
  const v = variantClasses[variant];
  const shadowTone = expanded ? "shadow-md" : "shadow-sm";

  const verticalWidth = expanded ? W_EXPANDED : W_COLLAPSED;

  /** Compact header/top-strip pills; icons omitted via `icon == null`. */
  const horizontalSizing =
    orientation === "horizontal"
      ? "w-[100px] min-w-[100px] max-w-[112px] shrink-0 sm:w-[106px] sm:min-w-[106px] sm:max-w-[118px]"
      : "";

  const tabShell =
    orientation === "vertical"
      ? cn(railTabVertical, verticalWidth, shadowTone, active ? v.active : v.inactive)
      : cn(railTabHorizontalHeader, horizontalSizing, active ? v.active : v.inactive, "!shadow-sm");

  const gloss =
    orientation === "vertical" ? (
      <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/15 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
    ) : null;

  const labelTypographyVertical =
    "min-w-0 truncate text-left text-sm tracking-[0.08em] transition-[letter-spacing,text-shadow] duration-200 ease-out group-hover:tracking-[0.12em] group-hover:[text-shadow:0_0_10px_rgba(255,255,255,0.28)]";

  const labelTypographyHorizontal =
    "w-full whitespace-normal text-center text-[11px] font-bold leading-snug tracking-[0.08em] text-white sm:text-xs";

  const labelBlockVertical = <span className={labelTypographyVertical}>{label}</span>;

  const labelBlockHorizontal = <span className={labelTypographyHorizontal}>{label}</span>;

  const innerVertical = (
    <>
      {gloss}
      {icon}
      {labelBlockVertical}
      {showActiveDot ? (
        <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
      ) : null}
      {trailing}
    </>
  );

  /** Top nav: anchor to pill (`relative` on shell), not inner flex — avoids clipping/stacking quirks per route. */
  const horizontalSelectedDot =
    active ? (
      <span
        className="pointer-events-none absolute right-2 top-2 z-[3] h-2 w-2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
        aria-hidden
      />
    ) : null;

  const innerHorizontal = (
    <>
      {gloss}
      <span className="flex w-full flex-col items-center justify-center gap-1">
        {icon ? <span className="flex shrink-0 items-center justify-center">{icon}</span> : null}
        {labelBlockHorizontal}
        {trailing ? (
          <div className="flex w-full flex-col items-center gap-1 empty:hidden">{trailing}</div>
        ) : null}
      </span>
      {horizontalSelectedDot}
    </>
  );

  const inner = orientation === "vertical" ? innerVertical : innerHorizontal;

  const sharedInteractive =
    orientation === "vertical"
      ? "text-left"
      : "touch-manipulation select-none text-center";

  if (href) {
    return (
      <Link
        href={href}
        prefetch={prefetch}
        title={titleAttr}
        data-sidebar-key={itemKey}
        aria-current={active ? "page" : undefined}
        aria-expanded={orientation === "vertical" ? expanded : undefined}
        aria-selected={active}
        className={cn(tabShell, sharedInteractive)}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onFocusItem}
        onBlur={onBlurItem}
        onKeyDown={onRailKeyDown}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={titleAttr}
      data-sidebar-key={itemKey}
      aria-current={active ? "page" : undefined}
      aria-expanded={orientation === "vertical" ? expanded : undefined}
      aria-selected={active}
      className={cn(tabShell, sharedInteractive, "cursor-pointer border-0")}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onFocusItem}
      onBlur={onBlurItem}
      onClick={() => onProtectedNavigate?.()}
      onKeyDown={onRailKeyDown}
    >
      {inner}
    </button>
  );
}

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

type RailContextValue = {
  expandedKey: string | null;
  jobs: boolean;
  companies: boolean;
  smartApply: boolean;
  applications: boolean;
  actionCount: number;
  setHoverKey: (k: string | null) => void;
  setFocusKey: (k: string | null) => void;
  goProtected: (path: string) => void;
};

const RailContext = createContext<RailContextValue | null>(null);

function useRailContext() {
  const ctx = useContext(RailContext);
  if (!ctx) {
    throw new Error("Rail navigation requires SiteSideRailProvider.");
  }
  return ctx;
}

function DesktopRailNav() {
  const ctx = useRailContext();
  const {
    expandedKey,
    jobs,
    companies,
    smartApply,
    applications,
    actionCount,
    setHoverKey,
    setFocusKey,
    goProtected,
  } = ctx;

  const applicationsTrailingDesktop =
    actionCount > 0 ? (
      <span
        className="pointer-events-none absolute right-1.5 top-2 z-[4] inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-black leading-none text-white ring-1 ring-white/40"
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
    ) : applications ? (
      <span className="pointer-events-none absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60" />
    ) : null;

  return (
    <nav
      role="navigation"
      id="sidebar-tabs"
      aria-label="Sections"
      className="group/sidebar fixed left-0 top-0 z-[65] hidden h-screen w-[112px] flex-col py-10 lg:flex"
    >
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
      <SidebarItem
        itemKey="jobs"
        orientation="vertical"
        expanded={expandedKey === "jobs"}
        active={jobs}
        variant="teal"
        label="Jobs"
        titleAttr="Jobs"
        href="/jobs"
        icon={<IconDiamondFilled className="h-3.5 w-3.5 shrink-0 text-white opacity-95" />}
        showActiveDot={jobs}
        onEnter={() => setHoverKey("jobs")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("jobs")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="companies"
        orientation="vertical"
        expanded={expandedKey === "companies"}
        active={companies}
        variant="rose"
        label="Companies"
        titleAttr="Companies"
        href="/companies"
        icon={<IconDiamondOutline className="h-3.5 w-3.5 shrink-0 text-white opacity-95" />}
        showActiveDot={companies}
        onEnter={() => setHoverKey("companies")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("companies")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="smart-apply"
        orientation="vertical"
        expanded={expandedKey === "smart-apply"}
        active={smartApply}
        variant="brand"
        label="Smart Apply"
        titleAttr="Smart Apply"
        icon={<IconSmartApply />}
        showActiveDot={smartApply}
        onProtectedNavigate={() => goProtected("/smart-apply")}
        onEnter={() => setHoverKey("smart-apply")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("smart-apply")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="applications"
        orientation="vertical"
        expanded={expandedKey === "applications"}
        active={applications}
        variant="amber"
        label={expandedKey === "applications" ? "Applications" : "Apps"}
        titleAttr="Applications"
        icon={<IconApplications />}
        showActiveDot={false}
        trailing={applicationsTrailingDesktop}
        onProtectedNavigate={() => goProtected("/applications")}
        onEnter={() => setHoverKey("applications")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("applications")}
        onBlurItem={() => setFocusKey(null)}
      />
      </div>
      <div className="mt-auto shrink-0 px-2 pb-2 pt-3">
        <SidebarBrowseQuotaCard />
      </div>
    </nav>
  );
}

/** Horizontal pills (unused by default headers). App/marketing shells use `MobileSectionsMenu` instead. Must render inside `SiteSideRailProvider`. */
export function SiteSideRailMobileNav() {
  const ctx = useRailContext();
  const {
    expandedKey,
    jobs,
    companies,
    smartApply,
    applications,
    actionCount,
    setHoverKey,
    setFocusKey,
    goProtected,
  } = ctx;

  const applicationsTrailingMobile =
    actionCount > 0 ? (
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
    ) : null;

  return (
    <nav
      role="navigation"
      aria-label="Sections"
      className="-mx-1 flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-x-auto overflow-y-visible px-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
    >
      <SidebarItem
        itemKey="jobs"
        orientation="horizontal"
        expanded={expandedKey === "jobs"}
        active={jobs}
        variant="teal"
        label="Jobs"
        titleAttr="Jobs"
        href="/jobs"
        icon={null}
        onEnter={() => setHoverKey("jobs")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("jobs")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="companies"
        orientation="horizontal"
        expanded={expandedKey === "companies"}
        active={companies}
        variant="rose"
        label="Companies"
        titleAttr="Companies"
        href="/companies"
        icon={null}
        onEnter={() => setHoverKey("companies")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("companies")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="smart-apply"
        orientation="horizontal"
        expanded={expandedKey === "smart-apply"}
        active={smartApply}
        variant="brand"
        label="Smart Apply"
        titleAttr="Smart Apply"
        icon={null}
        onProtectedNavigate={() => goProtected("/smart-apply")}
        onEnter={() => setHoverKey("smart-apply")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("smart-apply")}
        onBlurItem={() => setFocusKey(null)}
      />
      <SidebarItem
        itemKey="applications"
        orientation="horizontal"
        expanded={expandedKey === "applications"}
        active={applications}
        variant="amber"
        label="Applications"
        titleAttr="Applications"
        icon={null}
        trailing={applicationsTrailingMobile}
        onProtectedNavigate={() => goProtected("/applications")}
        onEnter={() => setHoverKey("applications")}
        onLeave={() => setHoverKey(null)}
        onFocusItem={() => setFocusKey("applications")}
        onBlurItem={() => setFocusKey(null)}
      />
    </nav>
  );
}

/** Wrap app/marketing layouts so the desktop rail + header-inline mobile rail share state. */
export function SiteSideRailProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { stats } = useApplications();

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const jobs = pathname.startsWith("/jobs");
  const companies = pathname.startsWith("/companies") || pathname.startsWith("/company");
  const smartApply =
    pathname.startsWith(SMART_APPLY_APP_PATH) || pathname.startsWith(SMART_APPLY_FEATURE_PATH);
  const applications =
    pathname.startsWith(APPLICATIONS_APP_PATH) ||
    pathname.startsWith(APPLICATION_TRACKER_FEATURE_PATH);

  const activeKey = useMemo<string | null>(() => {
    if (jobs) return "jobs";
    if (companies) return "companies";
    if (smartApply) return "smart-apply";
    if (applications) return "applications";
    return null;
  }, [jobs, companies, smartApply, applications]);

  const expandedKey = useMemo(() => hoverKey ?? focusKey ?? activeKey, [hoverKey, focusKey, activeKey]);

  const actionCount = stats && stats.needsAction > 0 ? stats.needsAction : 0;

  const goProtected = useCallback(
    (path: string) => {
      if (!authLoaded) return;
      const dest =
        path === SMART_APPLY_APP_PATH || path === APPLICATIONS_APP_PATH
          ? protectedFeatureNavDest(path, isSignedIn)
          : path;
      signalProgrammaticNavigation(dest);
      router.push(dest);
    },
    [authLoaded, isSignedIn, router],
  );

  const ctxValue = useMemo<RailContextValue>(
    () => ({
      expandedKey,
      jobs,
      companies,
      smartApply,
      applications,
      actionCount,
      setHoverKey,
      setFocusKey,
      goProtected,
    }),
    [expandedKey, jobs, companies, smartApply, applications, actionCount, goProtected],
  );

  return (
    <RailContext.Provider value={ctxValue}>
      <DesktopRailNav />
      {children}
    </RailContext.Provider>
  );
}
