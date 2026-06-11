"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { cn } from "../../lib/cn";

/** Do not add `position: relative` here — it overrides `fixed` when classes are concatenated (cn has no tailwind-merge). */
const shellClass =
  "group z-[100] flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-ink/10 bg-surface transition-all duration-300 hover:border-brand hover:shadow-md pointer-events-auto";

const fixedFrame: CSSProperties = {
  position: "fixed",
  top: 10,
  right: 24,
  left: "auto",
  bottom: "auto",
};

/**
 * Fixed top-right entry to account. Inline coordinates avoid Tailwind order conflicts with other utilities.
 */
export function FixedAccountAvatar() {
  const { user, isLoaded } = useUser();
  if (!isLoaded) {
    return (
      <div
        style={fixedFrame}
        className={cn(shellClass, "cursor-default opacity-60", "hidden lg:flex")}
        aria-hidden
      />
    );
  }

  if (user) {
    const label =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      user.primaryEmailAddress?.emailAddress ||
      "Account";
    const initial =
      (user.firstName?.[0] || user.primaryEmailAddress?.emailAddress?.[0] || "?").toUpperCase();

    return (
      <Link
        href="/account"
        prefetch={false}
        style={fixedFrame}
        className={cn(shellClass, "hidden lg:flex")}
        aria-label={`Account (${label})`}
      >
        {user.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Clerk avatar URLs are external; avoid image domain config.
          <img
            src={user.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-ink/70">{initial}</span>
        )}
      </Link>
    );
  }

  return (
    <SignInButton mode="modal">
      <button type="button" style={fixedFrame} className={cn(shellClass, "hidden lg:flex")} aria-label="Sign in">
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
  );
}
