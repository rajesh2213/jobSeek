"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useAccountPlan } from "../../lib/useAccountPlan";

export function MarketingHeader() {
  const { user, isLoaded } = useUser();
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const showGetPro = !(planLoaded && isPro);
  const initial =
    (user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || "A").toUpperCase();

  return (
    <header
      className="sticky top-0 z-[70] border-b border-ink/10 bg-[rgba(245,242,235,0.92)] backdrop-blur"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          prefetch={false}
          className="group relative z-[80] flex shrink-0 items-baseline gap-1 no-underline transition-transform duration-200 hover:scale-[1.02]"
        >
          <span className="font-display text-2xl italic text-ink transition-colors group-hover:text-brand sm:text-3xl">
            jobseek
          </span>
          <span
            className="mb-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand transition-all group-hover:shadow-[0_0_0_6px_rgba(234,88,12,0.16)]"
            aria-hidden
          />
        </Link>
        <div className="flex items-center gap-2">
          {showGetPro ? (
            <Link
              href="/pricing"
              prefetch={false}
              className="rounded-full bg-brand px-4 py-2 text-sm font-bold !text-white no-underline transition-colors visited:!text-white hover:bg-brand-hover hover:!text-white active:!text-white"
            >
              Get Pro
            </Link>
          ) : null}
          {!isLoaded ? (
            <div className="h-11 w-11 rounded-full border-2 border-ink/10 bg-surface/70" aria-hidden />
          ) : user ? (
            <Link
              href="/account"
              prefetch={false}
              className="group flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-ink/10 bg-surface transition-all duration-300 hover:border-brand hover:shadow-md"
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
                className="group flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-ink/10 bg-surface transition-all duration-300 hover:border-brand hover:shadow-md"
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
    </header>
  );
}
