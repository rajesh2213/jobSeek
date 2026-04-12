"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ApiRequestError,
  fetchSavedSearches,
  patchSavedSearchAlert,
  type SavedSearchItem,
} from "../../../lib/api";
import { useAccountPlan } from "../../../lib/useAccountPlan";
import { Container } from "../../../components/ui/Container";
import { Button, buttonClassName } from "../../../components/ui/Button";

function formatAlertLastSent(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Never";
  const diff = Date.now() - t;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SavedSearchesPage() {
  const { isSignedIn, getToken } = useAuth();
  const { isPro } = useAccountPlan();
  const [rows, setRows] = useState<SavedSearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) {
        setRows([]);
        return;
      }
      const res = await fetchSavedSearches(token);
      setRows(res.data);
    } catch {
      setError("Could not load saved searches.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggleAlert = async (saved: SavedSearchItem, enabled: boolean, threshold?: 5 | 10) => {
    if (!isPro) return;
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setUpdatingId(saved.id);
    try {
      const resolvedThreshold: 5 | 10 =
        threshold ?? (saved.alertThreshold === 10 ? 10 : 5);
      const updated = await patchSavedSearchAlert(token, saved.id, {
        enabled,
        threshold: resolvedThreshold,
      });
      setRows((prev) => prev.map((r) => (r.id === saved.id ? updated : r)));
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "PRO_REQUIRED") {
        setError("Pro required for job alerts.");
      } else {
        setError("Could not update alerts.");
      }
    } finally {
      setUpdatingId(null);
    }
  };

  if (!isSignedIn) {
    return (
      <Container width="readable" className="py-16 text-center">
        <p className="text-ink-muted">Sign in to manage saved searches.</p>
        <Link href="/jobs" className={buttonClassName({ variant: "primary", size: "sm", className: "mt-4 inline-flex" })}>
          Browse jobs
        </Link>
      </Container>
    );
  }

  return (
    <Container width="readable" className="py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-normal italic text-ink">Saved searches</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Manage job alerts and jump back to any saved filter set.
          </p>
        </div>
        <Button variant="outline" size="sm" href="/jobs">
          Back to jobs
        </Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No saved searches yet. Save one from the jobs page.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((saved) => {
            const title = saved.name?.trim() || "Saved search";
            return (
              <li
                key={saved.id}
                className="rounded-2xl border border-ink/10 bg-surface p-5 shadow-sm ring-1 ring-ink/5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-ink">
                      <span aria-hidden>🔔</span>
                      {title}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted line-clamp-2">{saved.query}</p>
                  </div>
                  <Link
                    href={saved.query}
                    className="shrink-0 text-sm font-semibold text-brand hover:underline"
                  >
                    Open search →
                  </Link>
                </div>

                <div className="mt-4 border-t border-ink/10 pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45">Job alerts</p>
                  {isPro ? (
                    <div className="mt-2 space-y-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={saved.alertEnabled}
                          disabled={updatingId === saved.id}
                          onChange={(e) => void onToggleAlert(saved, e.target.checked)}
                          className="rounded border-ink/30"
                        />
                        <span>Email when new jobs match</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                        <span>Notify every</span>
                        <select
                          className="rounded border border-ink/20 bg-canvas px-2 py-1 text-sm"
                          value={saved.alertThreshold === 10 ? 10 : 5}
                          disabled={updatingId === saved.id || !saved.alertEnabled}
                          onChange={(e) => {
                            const v = (Number(e.target.value) === 10 ? 10 : 5) as 5 | 10;
                            void onToggleAlert(saved, true, v);
                          }}
                        >
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                        </select>
                        <span>new jobs</span>
                      </div>
                      <p className="text-xs text-ink-muted">
                        Last sent: {formatAlertLastSent(saved.alertLastSentAt)}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-sm">
                      <p className="text-ink-muted">
                        <span className="mr-1.5 inline-flex rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand">
                          Pro
                        </span>
                        Get notified when new jobs match this search
                      </p>
                      <Link href="/pricing" className="font-semibold text-brand hover:underline">
                        Upgrade to unlock →
                      </Link>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
