"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApplications, type ApplicationItem } from "../../../lib/applicationsContext";
import { useAccountPlan } from "../../../lib/useAccountPlan";
import { Container } from "../../../components/ui/Container";
import { Button, buttonClassName } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ComingSoonPill } from "../../../components/ui/ComingSoonPill";
import { companyLogoSrcForDisplay } from "../../../lib/logoDisplay";
import { cn } from "../../../lib/cn";

const MS_DAY = 86400000;

const STATUS_ORDER = [
  "applied",
  "acknowledged",
  "assessment",
  "interview",
  "offer",
] as const;

type FilterTab = "all" | "active" | "action" | "archived";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "applied":
      return "bg-slate-200/90 text-slate-800 dark:bg-slate-600/40 dark:text-slate-100";
    case "acknowledged":
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100";
    case "assessment":
      return "bg-amber-100 text-amber-950 dark:bg-amber-900/35 dark:text-amber-100";
    case "interview":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/35 dark:text-emerald-100";
    case "offer":
      return "bg-[#E8533A]/15 text-[#c43d28] dark:bg-brand/25 dark:text-brand";
    case "rejected":
      return "bg-red-100 text-red-900 dark:bg-red-900/35 dark:text-red-100";
    case "archived":
      return "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60";
    default:
      return "bg-ink/10 text-ink";
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    applied: "Applied",
    acknowledged: "Acknowledged",
    assessment: "Assessment",
    interview: "Interview",
    offer: "Offer 🎉",
    rejected: "Rejected",
    archived: "Archived",
  };
  return map[status] ?? status;
}

function needsActionLightning(status: string): boolean {
  return ["assessment", "interview", "offer"].includes(status);
}

function daysBetween(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / MS_DAY);
}

function noResponseWarning(a: ApplicationItem): boolean {
  return a.status === "applied" && daysBetween(a.appliedAt) > 14;
}

export function ApplicationsPageClient() {
  const { isPro, isLoaded: planLoaded } = useAccountPlan();
  const {
    applications,
    isLoading,
    updateStatus,
    updateNotes,
    removeApplication,
  } = useApplications();

  const [filter, setFilter] = useState<FilterTab>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const safeApplications = Array.isArray(applications) ? applications : [];

  const filtered = useMemo(() => {
    let list = safeApplications;
    if (filter === "all") {
      list = safeApplications;
    } else if (filter === "active") {
      list = list.filter((a) => !a.archived);
    } else if (filter === "archived") {
      list = list.filter((a) => a.archived);
    } else if (filter === "action") {
      list = list.filter(
        (a) =>
          a.status === "applied" &&
          new Date(a.lastActivityAt).getTime() < Date.now() - 14 * MS_DAY,
      );
    }
    return list;
  }, [safeApplications, filter]);

  const selected = useMemo(
    () => filtered.find((a) => a.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const emptyCopy = useMemo(() => {
    if (safeApplications.length === 0) {
      return {
        title: "No applications yet",
        body: 'Click "Apply" on any job to automatically track your application',
        showBrowse: true,
      } as const;
    }
    if (filter === "action") {
      return {
        title: "No stale applications to follow up",
        body:
          "The Action tab shows roles still marked Applied with no activity in the last 14 days. Your other applications are either newer or already moved to a later stage — check Active or All.",
        showBrowse: false,
      } as const;
    }
    if (filter === "archived") {
      return {
        title: "No archived applications",
        body: "Applications you remove or that auto-archive after 30 days will appear here.",
        showBrowse: false,
      } as const;
    }
    return {
      title: "No applications in this view",
      body: "Try another filter tab or add an application from the job board.",
      showBrowse: true,
    } as const;
  }, [safeApplications.length, filter]);

  useEffect(() => {
    if (selected) {
      setNotesDraft(selected.notes ?? "");
    }
  }, [selected]);

  if (!planLoaded) {
    return (
      <Container width="wide" className="py-16 text-center text-ink-muted">
        Loading…
      </Container>
    );
  }

  return (
    <Container width="wide" className="py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-3xl font-normal italic text-ink">Applications</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/jobs"
            className={buttonClassName({ variant: "outline", size: "sm", outlineTone: "brand" })}
          >
            + Add manually
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="lg:w-[380px] lg:shrink-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <div className="mb-3 flex flex-wrap gap-2 border-b border-ink/10 pb-3">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["action", "⚡ Action"],
                ["archived", "Archived"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                  filter === key
                    ? "bg-brand text-white"
                    : "bg-ink/5 text-ink/70 hover:bg-ink/10",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-sm text-ink-muted">Loading applications…</p>
          ) : filtered.length === 0 ? (
            <Card accent="amber" className="p-8 text-center">
              <p className="text-4xl" aria-hidden>
                📋
              </p>
              <h2 className="mt-4 font-semibold text-ink">{emptyCopy.title}</h2>
              <p className="mt-2 text-sm text-ink-muted">{emptyCopy.body}</p>
              {emptyCopy.showBrowse ? (
                <Link
                  href="/jobs"
                  className={cn(
                    buttonClassName({ variant: "primary", size: "sm" }),
                    "mt-6 inline-flex",
                  )}
                >
                  Browse jobs →
                </Link>
              ) : null}
            </Card>
          ) : (
            <ul className="space-y-3">
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={cn(
                      "w-full rounded-xl border p-4 text-left transition-colors",
                      selectedId === a.id
                        ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                        : "border-ink/10 bg-surface hover:border-ink/20",
                    )}
                  >
                    <div className="flex gap-3">
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-ink/5">
                        {a.job.companyLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={companyLogoSrcForDisplay(a.job.companyLogo)}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-xs font-bold text-ink/40">
                            {a.job.companyName.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-semibold text-ink">{a.job.companyName}</p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                              statusBadgeClass(a.status),
                            )}
                          >
                            {statusLabel(a.status)}
                            {needsActionLightning(a.status) ? " ⚡" : ""}
                          </span>
                        </div>
                        <p className="truncate text-sm text-ink-muted">{a.job.title}</p>
                        <p className="mt-1 text-xs text-ink/50">
                          📍 {a.job.locationCountry} · {a.job.workType}
                        </p>
                        <p className="mt-1 text-xs text-ink/45">
                          Applied {daysBetween(a.appliedAt) === 0 ? "today" : `${daysBetween(a.appliedAt)} days ago`}
                        </p>
                        {noResponseWarning(a) ? (
                          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                            ⚠ No response in {daysBetween(a.appliedAt)} days
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="min-h-[480px] flex-1 rounded-2xl border border-ink/10 bg-surface/50 p-6 shadow-sm">
          {!selected ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-4 text-center">
              <ul className="mt-6 max-w-md space-y-3 text-left text-sm leading-relaxed text-ink-muted">
                <li className="flex gap-2">
                  <span className="text-ink/80" aria-hidden>
                    •
                  </span>
                  <span>
                    {isPro ? (
                      <Link href="/saved-searches" className="font-medium text-brand hover:underline">
                        Email alerts when new jobs match your searches
                      </Link>
                    ) : (
                      <>
                        <span className="mr-1.5 inline-flex items-center rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                          Pro
                        </span>
                        Email alerts when new jobs match your searches —{" "}
                        <Link href="/pricing" className="font-medium text-brand hover:underline">
                          Upgrade
                        </Link>
                      </>
                    )}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-ink/80" aria-hidden>
                    •
                  </span>
                  <span>Reply and interview tracking from your inbox (coming soon)</span>
                </li>
              </ul>
              <button
                type="button"
                disabled
                className="mt-8 cursor-not-allowed rounded-full border border-ink/15 bg-ink/5 px-5 py-2.5 text-sm font-semibold text-ink/40"
              >
                Notify me when inbox tracking is ready
              </button>
            </div>
          ) : (
            <ApplicationDetail
              key={selected.id}
              application={selected}
              notesDraft={notesDraft}
              setNotesDraft={setNotesDraft}
              onStatusChange={(status) => void updateStatus(selected.id, status)}
              onSaveNotes={() => void updateNotes(selected.id, notesDraft.trim() || null)}
              onRemove={() => {
                void removeApplication(selected.id);
                setSelectedId(null);
              }}
            />
          )}
        </section>
      </div>
    </Container>
  );
}

function ApplicationDetail({
  application: a,
  notesDraft,
  setNotesDraft,
  onStatusChange,
  onSaveNotes,
  onRemove,
}: {
  application: ApplicationItem;
  notesDraft: string;
  setNotesDraft: (s: string) => void;
  onStatusChange: (status: string) => void;
  onSaveNotes: () => void;
  onRemove: () => void;
}) {
  const appliedDate = new Date(a.appliedAt);
  const formatted = appliedDate.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-2xl text-ink">
          {a.job.companyName} — {a.job.title}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Applied {formatted}</p>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-ink/45">Status</p>
        <StatusStepper current={a.status} onSelect={onStatusChange} />
        <div className="mt-4">
          <label className="sr-only" htmlFor="app-status">
            Change status
          </label>
          <select
            id="app-status"
            value={a.status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm font-semibold text-ink"
          >
            {[
              "applied",
              "acknowledged",
              "assessment",
              "interview",
              "offer",
              "rejected",
              "archived",
            ].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">📧 Email tracking</span>
          <ComingSoonPill />
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          Automatic email detection will appear here when available.
        </p>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink/45">Notes</p>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          rows={5}
          placeholder="Add notes about this application — e.g. recruiter name, salary info"
          className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-3 text-sm text-ink placeholder:text-ink/35"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onSaveNotes}
        >
          Save notes
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-ink/10 pt-6">
        <a
          href={a.job.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: "outline", size: "sm", outlineTone: "brand" })}
        >
          🔗 View job posting
        </a>
        <button
          type="button"
          onClick={onRemove}
          className={buttonClassName({ variant: "outline", size: "sm", outlineTone: "rose", className: "text-red-700" })}
        >
          🗑 Remove application
        </button>
      </div>
    </div>
  );
}

function StatusStepper({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (s: string) => void;
}) {
  if (current === "rejected" || current === "archived") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-3 py-1 text-xs font-bold", statusBadgeClass(current))}>
          {statusLabel(current)}
        </span>
      </div>
    );
  }

  const rawIdx = STATUS_ORDER.indexOf(current as (typeof STATUS_ORDER)[number]);
  const currentIdx = rawIdx < 0 ? 0 : rawIdx;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {STATUS_ORDER.map((s, i) => {
        const active = currentIdx === i;
        const past = currentIdx > i;
        return (
          <div key={s} className="flex items-center">
            {i > 0 ? <span className="mx-1 text-ink/25">→</span> : null}
            <button
              type="button"
              onClick={() => onSelect(s)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                active
                  ? "bg-brand text-white ring-2 ring-brand/30"
                  : past
                    ? "bg-ink/10 text-ink/70 hover:bg-ink/15"
                    : "bg-ink/5 text-ink/40 hover:bg-ink/10",
              )}
            >
              {statusLabel(s).replace(" 🎉", "")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
