"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  deleteSavedSearch,
  fetchSavedSearches,
  type SavedSearchItem,
} from "../../../lib/api";
import { Container } from "../../../components/ui/Container";

export default function SavedSearchesPage() {
  const { getToken, isSignedIn } = useAuth();
  const [saved, setSaved] = useState<SavedSearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetchSavedSearches(token);
        if (!cancelled) setSaved(res.data);
      } catch {
        if (!cancelled) setMessage("Could not load saved searches.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  async function onDelete(id: string): Promise<void> {
    try {
      const token = await getToken();
      if (!token) return;
      await deleteSavedSearch(token, id);
      setSaved((prev) => prev.filter((row) => row.id !== id));
    } catch {
      setMessage("Could not delete saved search.");
    }
  }

  return (
    <Container width="jobs" className="py-10">
      <h1 className="font-sans text-2xl font-semibold text-ink">Saved searches</h1>
      <p className="mt-2 text-sm text-ink-muted">You can save up to 3 searches.</p>

      {message ? <p className="mt-3 text-sm text-ink-muted">{message}</p> : null}

      {!isSignedIn ? (
        <p className="mt-6 text-sm text-ink-muted">Sign in to manage saved searches.</p>
      ) : loading ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : saved.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">No saved searches yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {saved.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <Link href={row.query} className="min-w-0 flex-1 truncate text-sm text-brand hover:underline">
                {row.name?.trim() || row.query}
              </Link>
              <button
                type="button"
                onClick={() => void onDelete(row.id)}
                className="text-xs font-semibold text-ink-muted hover:text-brand"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
}
