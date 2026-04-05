"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import type { JobItem } from "../../lib/api";
import { JobCard } from "./JobCard";

const CORAL = "#E8533A";
const INK = "#1a1a1a";

function formatHm(ms: number): { h: number; m: number } {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { h, m };
}

function LockIconCoral({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        stroke={CORAL}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={5}
        y={11}
        width={14}
        height={10}
        rx={2}
        stroke={CORAL}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  resetAt: string;
  count: number;
  previewJobs: JobItem[];
}

/** Jobs with postedAt on current UTC calendar day (preview slice only — TODO: API for true total). */
function postedTodayInPreview(jobs: JobItem[]): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const d = now.getUTCDate();
  return jobs.filter((j) => {
    if (!j.postedAt) return false;
    const p = new Date(j.postedAt);
    return p.getUTCFullYear() === y && p.getUTCMonth() === mo && p.getUTCDate() === d;
  }).length;
}

export function DailyCapWall({ resetAt, count, previewJobs }: Props) {
  const { isSignedIn } = useAuth();
  const [{ h, m }, setHm] = useState(() => {
    const target = new Date(resetAt).getTime();
    return formatHm(Math.max(0, target - Date.now()));
  });

  const postedToday = useMemo(() => postedTodayInPreview(previewJobs), [previewJobs]);

  useEffect(() => {
    const target = new Date(resetAt).getTime();
    const tick = () => setHm(formatHm(Math.max(0, target - Date.now())));
    tick();
    // 1s so hours/minutes update as soon as the wall clock crosses (60000 felt “stuck”).
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resetAt]);

  return (
    <div className="mt-6 space-y-5" aria-labelledby="daily-cap-heading">
      <div
        id="daily-cap-heading"
        className="jobseek-daily-cap-highlight rounded-2xl pl-6 pr-6 pt-7 pb-7 text-left"
        style={{
          border: "1px solid rgba(0,0,0,0.06)",
          borderLeft: `4px solid ${CORAL}`,
          background: "linear-gradient(135deg, #ffffff 0%, #fff8f6 55%, #F5F2EB 100%)",
        }}
      >
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0" aria-hidden>
            <LockIconCoral size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="font-sans font-bold leading-snug tracking-tight"
              style={{ color: INK, fontSize: 20, fontWeight: 700 }}
            >
              You&apos;re in the top 10% of job seekers today
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">
              You&apos;ve reviewed all your free jobs for today. Meanwhile,{" "}
              <span className="font-semibold text-ink">{count.toLocaleString()}</span> more roles
              match your search — including listings from the last hour most people haven&apos;t
              opened yet.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
              <div>
                <p
                  className="font-semibold uppercase tracking-wide text-ink/45"
                  style={{ fontSize: 11 }}
                >
                  🔢 Roles hidden
                </p>
                <p className="mt-1 font-bold tabular-nums" style={{ color: CORAL, fontSize: 18 }}>
                  {count.toLocaleString()}
                </p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wide text-ink/45"
                  style={{ fontSize: 11 }}
                >
                  ⏱ Resets in
                </p>
                <p className="mt-1 font-bold tabular-nums" style={{ color: CORAL, fontSize: 18 }}>
                  {h}h {m}m
                </p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wide text-ink/45"
                  style={{ fontSize: 11 }}
                >
                  📈 Posted today
                </p>
                <p className="mt-1 font-bold tabular-nums" style={{ color: CORAL, fontSize: 18 }}>
                  {/* TODO: API aggregate for full index; below uses preview jobs only */}
                  {previewJobs.length === 0 ? "—" : String(postedToday)}
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3">
              <Link
                href="/pricing"
                className="block w-full text-center font-bold text-white no-underline transition-opacity hover:opacity-95"
                style={{
                  backgroundColor: CORAL,
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                See all {count.toLocaleString()} matching roles →
              </Link>
              {!isSignedIn ? (
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-ink/10 bg-transparent py-3 text-[15px] font-semibold text-ink/80 transition-colors hover:bg-ink/[0.04]"
                  >
                    Sign in to save your progress
                  </button>
                </SignInButton>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="relative isolate overflow-hidden rounded-2xl">
        <div
          className="pointer-events-none flex select-none flex-col gap-5"
          style={{ filter: "blur(6px)" }}
        >
          {previewJobs.length > 0 ? (
            previewJobs.slice(-3).map((job) => <JobCard key={job.id} job={job} />)
          ) : (
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 rounded-2xl border border-ink/[0.06] bg-white shadow-sm"
                aria-hidden
              />
            ))
          )}
        </div>
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background: "linear-gradient(to bottom, rgba(245,242,235,0.3), rgba(245,242,235,0.98))",
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
