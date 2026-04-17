"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApplications } from "../../lib/applicationsContext";
import { cn } from "../../lib/cn";
import { buttonClassName } from "../ui/Button";
import type { AccentTone } from "../ui/types";

interface Props {
  jobId: string;
  outlineTone?: AccentTone;
  size?: "sm" | "md";
  className?: string;
}

export function AppliedToggleButton({
  jobId,
  outlineTone = "brand",
  size = "sm",
  className,
}: Props) {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const { appliedJobIds, markApplied, unmarkApplied } = useApplications();
  const [pending, setPending] = useState(false);
  const applied = appliedJobIds.has(jobId);

  const onToggle = async () => {
    if (pending) return;
    if (!isSignedIn) {
      const redirect = encodeURIComponent(
        `${window.location.pathname}${window.location.search}`,
      );
      router.push(`/sign-in?redirect_url=${redirect}`);
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

  return (
    <button
      type="button"
      aria-pressed={applied}
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
      {pending ? "Updating..." : applied ? "Applied" : "Mark applied"}
    </button>
  );
}
