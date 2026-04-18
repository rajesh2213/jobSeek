"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserProfile, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { createPortal } from "react-dom";
import type { Appearance } from "@clerk/types";
import {
  fetchSavedSearchAlertStatus,
  fetchSmartApplyStatus,
  type UserMeResponse,
} from "../../lib/api";
import { isPro as isPaidPlan, PLAN_LIMITS } from "../../lib/planLimits";
import { useResume } from "../../lib/resumeContext";
import { ResumeUploadModal } from "../resume/ResumeUploadModal";

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  const days = Math.floor(diff / day);
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

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
  const { signOut } = useClerk();
  const { getToken, isSignedIn } = useAuth();
  const { user, isLoaded } = useUser();
  const { hasResume, fileName, wordCount, resumeUpdatedAt, deleteResume, refreshStatus } =
    useResume();
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [me, setMe] = useState<UserMeResponse | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [activeAlertCount, setActiveAlertCount] = useState<number | null>(null);
  const [smartApplyStatus, setSmartApplyStatus] = useState<Awaited<
    ReturnType<typeof fetchSmartApplyStatus>
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/me");
        if (!res.ok) return;
        const data = (await res.json()) as UserMeResponse;
        if (!cancelled) setMe(data);
      } catch {
        /* Ignore fetch errors; plan stays null and render uses free-tier defaults. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken({ skipCache: true });
        if (!token) {
          if (!cancelled) setActiveAlertCount(null);
          return;
        }
        const rows = await fetchSavedSearchAlertStatus(token);
        const n = rows.filter((r) => r.alertEnabled).length;
        if (!cancelled) setActiveAlertCount(n);
      } catch {
        if (!cancelled) setActiveAlertCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken({ skipCache: true });
        if (!token) {
          if (!cancelled) setSmartApplyStatus(null);
          return;
        }
        const s = await fetchSmartApplyStatus(token);
        if (!cancelled) setSmartApplyStatus(s);
      } catch {
        if (!cancelled) setSmartApplyStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Prefer plan from /api/user/me; default matches backend free tier when absent.
  const plan = me?.plan ?? "free";
  const isPro = isPaidPlan(plan);
  const limit = me?.jobViewsLimit ?? PLAN_LIMITS.free.dailyJobViews;
  const rawUsed = me?.jobViewsToday ?? 0;
  const usedDisplay = isPro ? rawUsed : Math.min(rawUsed, limit);
  const pct = isPro || limit <= 0 ? 0 : Math.round((usedDisplay / limit) * 100);
  const smartApplyHref = isSignedIn
    ? "/smart-apply"
    : `/sign-in?redirect_url=${encodeURIComponent("/smart-apply")}`;

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

  const handleConfirmSignOut = async () => {
    if (isSigningOut) return;
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await signOut({ redirectUrl: "/jobs" });
    } catch {
      setSignOutError("Could not sign out right now. Please try again.");
      setIsSigningOut(false);
      setIsConfirmOpen(false);
    }
  };

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
            {plan === "free" ? (
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
            Active alerts
          </p>
          {activeAlertCount === null ? (
            <p className="mt-2 text-sm text-ink-muted">—</p>
          ) : activeAlertCount === 0 ? (
            <>
              <p className="mt-2 text-sm text-ink-muted">No job alerts active</p>
              <Link
                href="/saved-searches"
                className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
              >
                Set up alerts →
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm font-medium text-ink">
              {activeAlertCount} search{activeAlertCount === 1 ? "" : "es"} with alerts active
            </p>
          )}
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
              <p className="mt-2 text-[11px] leading-snug text-ink/55">
                Counts search results loaded, opening a job post, and company job lists. Refreshes
                daily at midnight UTC.
              </p>
            </>
          )}
        </div>

        <hr className="my-6 border-ink/10" />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/45">
            Smart Apply
          </p>
          {!isPro ? (
            <>
              <p className="mt-2 text-sm text-ink-muted">⚡ Pro feature</p>
              <Link
                href="/pricing"
                className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
              >
                Upgrade to unlock →
              </Link>
            </>
          ) : smartApplyStatus && smartApplyStatus.jobsLimit > 0 ? (
            <>
              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink/10"
                role="progressbar"
                aria-valuenow={smartApplyStatus.jobsToday}
                aria-valuemin={0}
                aria-valuemax={smartApplyStatus.jobsLimit}
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (smartApplyStatus.jobsToday / smartApplyStatus.jobsLimit) * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-sm text-ink">
                <span className="font-semibold">
                  {smartApplyStatus.jobsToday} of {smartApplyStatus.jobsLimit} today
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">Resets at midnight UTC</p>
              <Link
                href={smartApplyHref}
                className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
              >
                Set up profile →
              </Link>
            </>
          ) : isPro ? (
            <Link
              href={smartApplyHref}
              className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
            >
              Set up profile →
            </Link>
          ) : null}
        </div>

        <hr className="my-6 border-ink/10" />

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/45">
            Resume
          </p>
          {!hasResume ? (
            <>
              <p className="mt-2 text-sm text-ink-muted">No resume uploaded</p>
              <button
                type="button"
                onClick={() => setResumeModalOpen(true)}
                className="mt-3 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/40 hover:text-brand"
              >
                📄 Upload resume →
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 break-all text-sm font-semibold text-ink">📄 {fileName ?? "Resume"}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {wordCount} words
                {resumeUpdatedAt
                  ? ` · Updated ${formatRelativeTime(resumeUpdatedAt)}`
                  : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setResumeModalOpen(true)}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand/40 hover:text-brand"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => void deleteResume().then(() => refreshStatus())}
                  className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>

        <ResumeUploadModal open={resumeModalOpen} onClose={() => setResumeModalOpen(false)} />

        <hr className="my-6 border-ink/10" />

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            disabled={isSigningOut}
            className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
          {signOutError ? (
            <p className="text-center text-xs text-red-600" role="alert">
              {signOutError}
            </p>
          ) : null}
        </div>
      </aside>

      <div
        id="jobseek-clerk-profile"
        className="w-full min-w-0 rounded-2xl border border-line bg-surface shadow-card ring-1 ring-ink/5"
      >
        <UserProfile routing="hash" appearance={clerkAppearance} />
      </div>

      {isConfirmOpen && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/45 px-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-signout-title"
          aria-describedby="confirm-signout-description"
          onClick={() => {
            if (!isSigningOut) setIsConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface p-5 shadow-[0_18px_60px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-signout-title" className="text-lg font-semibold text-ink">
              Sign out of JobSeek?
            </h3>
            <p id="confirm-signout-description" className="mt-2 text-sm text-ink/70">
              You will be signed out on this device and redirected to jobs.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isSigningOut}
                className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSignOut()}
                disabled={isSigningOut}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        </div>
          ,
          document.body,
        )
        : null}
    </div>
  );
}
