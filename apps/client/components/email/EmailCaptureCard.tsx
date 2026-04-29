"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { subscribeGrowthEmail } from "../../lib/api";
import { cn } from "../../lib/cn";

export function EmailCaptureCard(props: {
  source: "homepage" | "job_page" | "jobs_listing" | "exit_intent" | "extension";
  title: string;
  /** Omit or leave empty to hide the subtitle line. */
  subtitle?: string;
  /** Tighter styling for hero strip / inline placements. */
  variant?: "default" | "compact";
  /** When true, visibility is handled by the parent (e.g. hero wrapper); skip the signed-in hide rule here. */
  suppressSignedInGate?: boolean;
  context?: { role?: string; location?: string; jobId?: string };
  className?: string;
  /** Called after a successful subscribe (e.g. parent closes a popup). */
  onSubscribeSuccess?: () => void;
}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signedInWithEmail = Boolean(
    isSignedIn && (user?.primaryEmailAddress?.emailAddress || (user?.emailAddresses?.length ?? 0) > 0),
  );
  if (!props.suppressSignedInGate && (!isLoaded || signedInWithEmail)) {
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setErr("Enter your email address.");
      return;
    }
    setBusy(true);
    try {
      await subscribeGrowthEmail({
        email: normalized,
        source: props.source,
        context: props.context,
      });
      setMsg("You're in. We will send top jobs to your inbox.");
      setEmail("");
      props.onSubscribeSuccess?.();
    } catch {
      setErr("Could not subscribe right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const compact = props.variant === "compact";
  const shell =
    props.className ??
    (compact
      ? "rounded-xl border border-brand/[0.12] bg-white/85 p-2.5 shadow-sm shadow-brand/[0.06] ring-1 ring-brand/[0.05]"
      : "rounded-2xl border border-ink/10 bg-white/70 p-4");

  return (
    <div className={shell}>
      <p
        className={
          compact
            ? "text-[11px] font-semibold leading-tight tracking-tight text-ink"
            : "text-sm font-semibold text-ink"
        }
      >
        {compact ? <span aria-hidden>✉️ </span> : null}
        {props.title}
      </p>
      {props.subtitle?.trim() ? (
        <p
          className={
            compact ? "mt-0.5 text-[10px] leading-snug text-ink/55" : "mt-1 text-xs text-ink/60"
          }
        >
          {props.subtitle}
        </p>
      ) : null}
      <form
        className={
          compact
            ? cn(
                "flex flex-col gap-1.5 sm:flex-row sm:items-center",
                props.subtitle?.trim() ? "mt-2" : "mt-1",
              )
            : cn(
                "flex flex-col gap-2 sm:flex-row",
                props.subtitle?.trim() ? "mt-3" : "mt-2",
              )
        }
        onSubmit={onSubmit}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={
            compact
              ? "min-w-0 flex-1 rounded-md border border-ink/12 bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
              : "min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          }
          required
        />
        <button
          type="submit"
          disabled={busy}
          className={
            compact
              ? "shrink-0 rounded-md bg-brand px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
              : "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          }
        >
          {busy ? "..." : compact ? "Subscribe" : "Get job emails"}
        </button>
      </form>
      {msg ? (
        <p className={compact ? "mt-1.5 text-[10px] text-emerald-700" : "mt-2 text-xs text-emerald-700"}>
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className={compact ? "mt-1.5 text-[10px] text-red-600" : "mt-2 text-xs text-red-600"}>{err}</p>
      ) : null}
    </div>
  );
}
