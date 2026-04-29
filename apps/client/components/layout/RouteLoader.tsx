"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const SHOW_DELAY_MS = 120;
const SAFETY_MAX_MS = 8000;

/** Dispatched only when {@link signalProgrammaticNavigation} decides pathname changes (matches `<a>` logic). */
const ROUTE_NAV_START_EVENT = "jobseek:route-load-start";

/**
 * Call immediately before `router.push(...)` when navigation is not triggered by an `<a>` click
 * (e.g. sidebar buttons). Mirrors RouteLoader's pathname-only rule so query-only pushes stay quiet.
 */
export function signalProgrammaticNavigation(destination: string) {
  if (typeof window === "undefined") return;
  try {
    const dest = new URL(destination, window.location.origin);
    if (dest.pathname === window.location.pathname) return;
    window.dispatchEvent(new Event(ROUTE_NAV_START_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Thin progress bar at the top of the viewport during slow navigations.
 *
 * Detection strategy:
 *  - START: capture-phase click on <a> with an internal href that differs
 *    from the current pathname. Shown only after SHOW_DELAY_MS so fast
 *    navigations never flash.
 *  - START (programmatic): {@link signalProgrammaticNavigation} before App Router `router.push`.
 *  - END: usePathname() changes (route settled) or safety timeout.
 *
 * No history monkey-patching — avoids false positives from hydration,
 * scroll restoration, and search-param-only updates.
 */
export function RouteLoader() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    clearTimeout(showTimer.current);
    clearTimeout(safetyTimer.current);
    showTimer.current = undefined;
    safetyTimer.current = undefined;
    setActive(false);
  };

  useEffect(() => {
    stop();
  }, [pathname]);

  useEffect(() => {
    const scheduleBar = () => {
      clearTimeout(showTimer.current);
      clearTimeout(safetyTimer.current);
      showTimer.current = setTimeout(() => {
        setActive(true);
        safetyTimer.current = setTimeout(() => setActive(false), SAFETY_MAX_MS);
      }, SHOW_DELAY_MS);
    };

    const onProgStart = () => scheduleBar();
    window.addEventListener(ROUTE_NAV_START_EVENT, onProgStart);

    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (/^(https?:|mailto:|tel:|#)/.test(href)) return;
      if (anchor.target === "_blank") return;
      try {
        const dest = new URL(href, location.origin);
        if (dest.pathname === location.pathname) return;
      } catch {
        return;
      }
      scheduleBar();
    };

    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(ROUTE_NAV_START_EVENT, onProgStart);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  if (!active) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] h-[2px] overflow-hidden">
      <div
        className="h-full rounded-r bg-brand"
        style={{
          animation: "routeBar 1.4s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes routeBar {
          0%   { width: 0%;   margin-left: 0%; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
