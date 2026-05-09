"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApplications } from "../../lib/applicationsContext";
import { signInWithNext } from "../../lib/signInUrl";
import { signalProgrammaticNavigation } from "../layout/RouteLoader";
import { cn } from "../../lib/cn";
import { buttonClassName } from "../ui/Button";
import type { AccentTone } from "../ui/types";

interface Props {
  jobId: string;
  outlineTone?: AccentTone;
  size?: "sm" | "md";
  className?: string;
  /** Shorter visible label for dense rows (e.g. job cards); full meaning via aria-label. */
  compact?: boolean;
}

export function AppliedToggleButton({
  jobId,
  outlineTone = "brand",
  size = "sm",
  className,
  compact = false,
}: Props) {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const { appliedJobIds, markApplied, unmarkApplied } = useApplications();
  const [pending, setPending] = useState(false);
  const applied = appliedJobIds.has(jobId);

  const onToggle = async () => {
    if (pending) return;
    if (!isSignedIn) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const dest = signInWithNext(returnTo);
      signalProgrammaticNavigation(dest);
      router.push(dest);
      return;
    }
    setPending(true);
    try {
      if (applied) {
        await unmarkApplied(jobId);
      } else {
        await markApplied(jobId);
      }
    } finally {
      setPending(false);
    }
  };

  const ariaLabel = pending
    ? "Updating applied state"
    : applied
      ? "Applied — click to remove from applied list"
      : "Mark job as applied";

  return (
    <button
      type="button"
      aria-pressed={applied}
      aria-label={ariaLabel}
      onClick={() => void onToggle()}
      disabled={pending}
      className={cn(
        buttonClassName({
          variant: "outline",
          size,
          outlineTone,
          className: cn(
            applied
              ? "border-teal/55 bg-teal-soft text-ink shadow-sm ring-1 ring-teal/25 hover:border-teal hover:bg-teal/15 dark:border-teal/50 dark:bg-teal/10 dark:ring-teal/30 dark:hover:bg-teal/20"
              : "",
            className,
          ),
        }),
      )}
      title={isSignedIn ? "Toggle applied state" : "Sign in to track applied jobs"}
    >
      {pending
        ? "Updating..."
        : applied
          ? "Applied"
          : compact
            ? "Mark"
            : "Mark applied"}
    </button>
  );
}
