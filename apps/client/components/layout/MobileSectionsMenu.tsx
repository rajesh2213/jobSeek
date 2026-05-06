"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "../../lib/cn";
import { signInWithNext } from "../../lib/signInUrl";
import { signalProgrammaticNavigation } from "./RouteLoader";

type Props = {
  open: boolean;
  onClose: () => void;
};

type RailVariant = "teal" | "rose" | "brand" | "amber";

const variantPill: Record<RailVariant, { on: string; off: string }> = {
  teal: {
    on: "bg-teal font-bold tracking-wide !text-white shadow-md",
    off: "bg-teal/85 font-bold tracking-wide !text-white hover:bg-teal hover:!text-white active:!text-white visited:!text-white",
  },
  rose: {
    on: "bg-rose font-bold tracking-wide !text-white shadow-md",
    off: "bg-rose/85 font-bold tracking-wide !text-white hover:bg-rose hover:!text-white active:!text-white visited:!text-white",
  },
  brand: {
    on: "bg-brand font-bold tracking-wide !text-white shadow-md",
    off: "bg-brand/85 font-bold tracking-wide !text-white hover:bg-brand hover:!text-white active:!text-white visited:!text-white",
  },
  amber: {
    on: "bg-amber font-bold tracking-wide !text-white shadow-md",
    off: "bg-amber/85 font-bold tracking-wide !text-white hover:bg-amber hover:!text-white active:!text-white visited:!text-white",
  },
};

/** Mirrors `railTabHorizontalHeader` + `horizontalSizing` feel: full-width stacked pills. */
const pillShell =
  "relative flex min-h-[44px] w-full shrink-0 flex-col items-center justify-center gap-1 overflow-visible rounded-xl px-3 py-2.5 text-center shadow-sm transition-[background-color,box-shadow] duration-150 ease-out !shadow-sm touch-manipulation select-none";

const labelClass =
  "w-full whitespace-normal text-[11px] font-bold leading-snug tracking-[0.08em] text-white sm:text-xs";

function ActiveDot() {
  return (
    <span
      className="pointer-events-none absolute right-2 top-2 z-[3] h-2 w-2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
      aria-hidden
    />
  );
}

function variantClass(v: RailVariant, active: boolean) {
  const { on, off } = variantPill[v];
  return cn(pillShell, active ? on : off);
}

export function MobileSectionsMenu({ open, onClose }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();

  const jobs = pathname.startsWith("/jobs");
  const companies = pathname.startsWith("/companies") || pathname.startsWith("/company");
  const smartApply = pathname.startsWith("/smart-apply");
  const applications = pathname.startsWith("/applications");

  useEffect(() => {
    setMobileOverflow(open);
    return () => setMobileOverflow(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const navigateAndClose = (path: string) => {
    onClose();
    signalProgrammaticNavigation(path);
    router.push(path);
  };

  const goProtected = (path: string) => {
    if (!authLoaded) return;
    const dest = isSignedIn ? path : signInWithNext(path);
    navigateAndClose(dest);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-[74] bg-black/25 pointer-events-auto lg:hidden"
        onClick={onClose}
      />
      <nav
        id="mobile-sections-nav"
        aria-label="Sections"
        className={cn(
          "fixed left-0 right-0 top-14 z-[75] max-h-[min(70vh,calc(100dvh-3.5rem))] overflow-y-auto overscroll-contain border-b border-ink/10 bg-canvas px-3 py-3 shadow-lg pointer-events-auto sm:top-16 lg:hidden",
        )}
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <button
            type="button"
            aria-current={jobs ? "page" : undefined}
            className={cn(variantClass("teal", jobs), "cursor-pointer border-0")}
            onClick={() => navigateAndClose("/jobs")}
          >
            <span className={labelClass}>Jobs</span>
            {jobs ? <ActiveDot /> : null}
          </button>
          <button
            type="button"
            aria-current={companies ? "page" : undefined}
            className={cn(variantClass("rose", companies), "cursor-pointer border-0")}
            onClick={() => navigateAndClose("/companies")}
          >
            <span className={labelClass}>Companies</span>
            {companies ? <ActiveDot /> : null}
          </button>
          <button
            type="button"
            aria-current={smartApply ? "page" : undefined}
            className={cn(variantClass("brand", smartApply), "cursor-pointer border-0")}
            onClick={() => goProtected("/smart-apply")}
          >
            <span className={labelClass}>Smart Apply</span>
            {smartApply ? <ActiveDot /> : null}
          </button>
          <button
            type="button"
            aria-current={applications ? "page" : undefined}
            className={cn(variantClass("amber", applications), "cursor-pointer border-0")}
            onClick={() => goProtected("/applications")}
          >
            <span className={labelClass}>Applications</span>
            {applications ? <ActiveDot /> : null}
          </button>
        </div>
      </nav>
    </>
  );
}

function setMobileOverflow(lock: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("overflow-hidden", lock);
}
