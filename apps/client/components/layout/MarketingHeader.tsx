"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccountPlan } from "../../lib/useAccountPlan";
import { cn } from "../../lib/cn";
import { MobileSectionsMenu } from "./MobileSectionsMenu";

const avatarShell =
  "group flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-ink/10 bg-surface transition-all duration-300 hover:border-brand hover:shadow-md";

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="h-5 w-5 text-ink"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

export function MarketingHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const { isPro, isLoaded: planLoaded, pendingUpgrade } = useAccountPlan();
  const showGetPro = !(planLoaded && (isPro || pendingUpgrade));
  const initial =
    (user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || "A").toUpperCase();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-[70] w-full bg-canvas">
      <div className="flex h-14 w-full min-h-14 items-center justify-between gap-2 px-4 sm:h-16 sm:min-h-16 sm:gap-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink/15 bg-surface text-ink shadow-sm touch-manipulation lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-sections-nav"
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            <span className="sr-only">{mobileNavOpen ? "Close menu" : "Open menu"}</span>
            <MenuIcon open={mobileNavOpen} />
          </button>
          <Link
            href="/"
            prefetch={false}
            className="group relative z-[80] flex min-w-0 shrink-0 items-baseline gap-1 no-underline transition-transform duration-200 hover:scale-[1.02]"
          >
            <span className="font-display text-2xl italic text-ink transition-colors group-hover:text-brand sm:text-3xl">
              jobloom
            </span>
            <span
              className="mb-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand transition-all group-hover:shadow-[0_0_0_6px_rgba(234,88,12,0.16)]"
              aria-hidden
            />
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showGetPro ? (
            <Link
              href="/pricing"
              prefetch={false}
              className={cn(
                "relative z-[2] inline-flex h-11 min-h-11 shrink-0 items-center rounded-full bg-brand px-4 text-sm font-bold !text-white no-underline shadow-sm",
                "visited:!text-white hover:bg-brand-hover hover:!text-white active:!text-white",
                "transition-[box-shadow,transform,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              Get Pro
            </Link>
          ) : null}
          {!isLoaded ? (
            <div className={cn(avatarShell, "cursor-default opacity-60")} aria-hidden />
          ) : user ? (
            <Link
              href="/account"
              prefetch={false}
              className={avatarShell}
              aria-label="Account"
            >
              {user.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-ink/70">{initial}</span>
              )}
            </Link>
          ) : (
            <SignInButton mode="modal">
              <button
                type="button"
                className={avatarShell}
                aria-label="Sign in"
              >
                <svg
                  className="h-5 w-5 text-ink/60 transition-colors group-hover:text-brand"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </button>
            </SignInButton>
          )}
        </div>
      </div>

      <MobileSectionsMenu open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </header>
  );
}
