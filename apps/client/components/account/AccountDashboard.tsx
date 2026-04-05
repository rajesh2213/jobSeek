"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserProfile, useUser } from "@clerk/nextjs";
import type { Appearance } from "@clerk/types";
import type { UserMeResponse } from "../../lib/api";

const clerkAppearance = {
  variables: { colorPrimary: "#E8533A" },
  elements: {
    card: {
      boxShadow: "none",
      border: "1px solid rgba(0,0,0,0.08)",
      width: "100%",
      maxWidth: "100%",
    },
    rootBox: { width: "100%", maxWidth: "100%" },
    // Hiding the navbar breaks Clerk’s two-column layout and clips the main column on the left.
    scrollBox: {
      width: "100%",
      maxWidth: "100%",
    },
    pageScrollBox: {
      padding: "24px",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
    },
  },
} satisfies Appearance;

export function AccountDashboard() {
  const { user, isLoaded } = useUser();
  const [me, setMe] = useState<UserMeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/me");
        if (!res.ok) return;
        const data = (await res.json()) as UserMeResponse;
        if (!cancelled) setMe(data);
      } catch {
        /* TODO: surface error; until then plan stays null → free fallback in render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // TODO: derive solely from GET /api/user/me once API is guaranteed; until then default matches backend free tier
  const plan = me?.plan ?? "free";
  const isPro = plan === "pro";
  const limit = me?.jobViewsLimit ?? 10;
  const rawUsed = me?.jobViewsToday ?? 0;
  const usedDisplay = isPro ? rawUsed : Math.min(rawUsed, limit);
  const pct = isPro || limit <= 0 ? 0 : Math.round((usedDisplay / limit) * 100);

  const primary = user?.emailAddresses?.find((e) => e.id === user?.primaryEmailAddressId) ??
    user?.emailAddresses?.[0];
  const email = primary?.emailAddress ?? "";
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    email ||
    "Member";

  if (!isLoaded) {
    return (
      <div className="box-border flex items-center justify-center px-4 py-16 text-sm text-ink-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="box-border mx-auto grid w-[90%] max-w-jobs grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="sticky top-6 self-start rounded-2xl border border-line bg-surface p-7 shadow-card ring-1 ring-ink/5">
        <div className="flex flex-col items-center text-center">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-20 w-20 rounded-full object-cover ring-2 ring-ink/10"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-2xl font-bold text-brand ring-2 ring-brand/20">
              {(displayName[0] || email[0] || "?").toUpperCase()}
            </div>
          )}
          <p className="mt-4 font-sans text-lg font-semibold tracking-tight text-ink">
            {displayName}
          </p>
          <p className="mt-1 break-all text-sm text-ink-muted">{email}</p>
        </div>

        <hr className="my-6 border-ink/10" />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/45">
            Current Plan
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm font-semibold text-ink">
              {plan === "pro" ? "PRO" : "FREE"}
            </span>
            {plan !== "pro" ? (
              <>
                <span className="text-ink/35" aria-hidden>
                  →
                </span>
                <Link
                  href="/pricing"
                  className="text-sm font-semibold text-brand hover:text-brand-hover hover:underline"
                >
                  Upgrade to Pro
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <hr className="my-6 border-ink/10" />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/45">
            Daily Jobs
          </p>
          {isPro ? (
            <p className="mt-2 text-sm font-medium text-ink">Unlimited</p>
          ) : (
            <>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink/10"
                role="progressbar"
                aria-valuenow={usedDisplay}
                aria-valuemin={0}
                aria-valuemax={limit}
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-ink">
                <span className="font-semibold">
                  {usedDisplay} of {limit} used
                </span>
              </p>
            </>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Refreshes daily at midnight UTC
          </p>
        </div>
      </aside>

      <div
        id="jobseek-clerk-profile"
        className="w-full min-w-0 rounded-2xl border border-line bg-surface shadow-card ring-1 ring-ink/5"
      >
        <UserProfile routing="hash" appearance={clerkAppearance} />
      </div>
    </div>
  );
}
