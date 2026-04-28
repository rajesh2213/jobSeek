"use client";

import { useState } from "react";
import { subscribeGrowthEmail } from "../../lib/api";

export function EmailCaptureCard(props: {
  source: "homepage" | "job_page" | "jobs_listing" | "exit_intent" | "extension";
  title: string;
  subtitle: string;
  context?: { role?: string; location?: string; jobId?: string };
  className?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    } catch {
      setErr("Could not subscribe right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={props.className ?? "rounded-2xl border border-ink/10 bg-white/70 p-4"}>
      <p className="text-sm font-semibold text-ink">{props.title}</p>
      <p className="mt-1 text-xs text-ink/60">{props.subtitle}</p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Subscribing..." : "Get job emails"}
        </button>
      </form>
      {msg ? <p className="mt-2 text-xs text-emerald-700">{msg}</p> : null}
      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
    </div>
  );
}
