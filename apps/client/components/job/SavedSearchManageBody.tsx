"use client";

import Link from "next/link";
import type { SavedSearchItem } from "../../lib/api";

export interface SavedSearchManageBodyProps {
  saved: SavedSearchItem;
  details: Array<{ label: string; value: string }>;
  displayName: string;
  isPro: boolean;
  editingSavedId: string | null;
  editingName: string;
  setEditingName: (v: string) => void;
  renamingSavedId: string | null;
  onStartRename: (saved: SavedSearchItem) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  deletingSavedId: string | null;
  onAlert: (saved: SavedSearchItem, enabled: boolean, threshold?: 5 | 10) => void;
  alertUpdatingId: string | null;
  formatAlertLastSent: (iso: string | null) => string;
}

/**
 * Shared management UI for a saved search (desktop hover panel + mobile sheet).
 */
export function SavedSearchManageBody({
  saved,
  details,
  displayName,
  isPro,
  editingSavedId,
  editingName,
  setEditingName,
  renamingSavedId,
  onStartRename,
  onRename,
  onDelete,
  deletingSavedId,
  onAlert,
  alertUpdatingId,
  formatAlertLastSent,
}: SavedSearchManageBodyProps) {
  return (
    <div className="text-xs leading-relaxed text-ink">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 font-semibold text-ink">{displayName}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-md p-1.5 text-ink transition-colors hover:bg-ink/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartRename(saved);
            }}
            aria-label="Rename saved search"
            title="Rename saved search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-4 w-4"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
              />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-ink transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 disabled:pointer-events-none disabled:opacity-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onDelete(saved.id);
            }}
            disabled={deletingSavedId === saved.id}
            aria-label="Delete saved search"
            title="Delete saved search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-4 w-4"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </button>
        </div>
      </div>
      {editingSavedId === saved.id ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            className="h-8 w-full rounded-lg border border-ink/20 bg-white px-2.5 text-xs text-ink placeholder:text-ink-muted shadow-sm focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/20"
            placeholder="Saved search name"
            maxLength={80}
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-hover"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onRename(saved.id);
            }}
            disabled={renamingSavedId === saved.id}
          >
            Save
          </button>
        </div>
      ) : null}
      {details.length > 0 ? (
        <div className="mt-3 max-h-40 space-y-2.5 overflow-y-auto pr-0.5 sm:max-h-48">
          {details.map((row) => (
            <div key={`${saved.id}-${row.label}`} className="text-xs leading-snug">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                {row.label}
              </span>
              <span className="mt-0.5 block break-words text-ink/90">{row.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-ink-muted">No filters</p>
      )}
      <div className="mt-3 rounded-lg border border-brand/25 bg-brand/5 p-3 ring-1 ring-brand/10">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
          <span aria-hidden className="text-base leading-none">
            🔔
          </span>
          Job alerts
        </p>
        {isPro ? (
          <div className="mt-2.5 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-ink">
              <input
                type="checkbox"
                checked={saved.alertEnabled}
                disabled={alertUpdatingId === saved.id}
                onChange={(e) => {
                  e.stopPropagation();
                  void onAlert(saved, e.target.checked);
                }}
                className="mt-0.5 rounded border-ink/30 text-brand focus:ring-brand/30"
              />
              <span className="leading-snug">Email when new jobs match</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 text-ink/80">
              <span>Notify every</span>
              <select
                className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs font-medium text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                value={saved.alertThreshold === 10 ? 10 : 5}
                disabled={alertUpdatingId === saved.id || !saved.alertEnabled}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  const v = (Number(e.target.value) === 10 ? 10 : 5) as 5 | 10;
                  void onAlert(saved, true, v);
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
              <span>new jobs</span>
            </div>
            <p className="text-[11px] text-ink/55">
              Last sent: {formatAlertLastSent(saved.alertLastSentAt)}
            </p>
          </div>
        ) : (
          <div className="mt-2.5 space-y-2">
            <p className="leading-snug text-ink/85">
              <span className="mr-1.5 inline-flex rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                Pro
              </span>
              Get notified when new jobs match this search
            </p>
            <Link
              href="/pricing"
              className="inline-block text-sm font-semibold text-brand underline underline-offset-2 hover:text-brand-hover"
              onClick={(e) => e.stopPropagation()}
            >
              Upgrade to unlock →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
