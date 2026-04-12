"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import type { AccentTone } from "../ui/types";
import { useApplications } from "../../lib/applicationsContext";
import { buttonClassName } from "../ui/Button";
import { cn } from "../../lib/cn";

interface Props {
  jobId: string;
  applyUrl: string;
  /** Card accent for outline Apply button */
  outlineTone?: AccentTone;
  size?: "sm" | "md";
  variant?: "primary" | "outline";
  className?: string;
}

export function ApplyJobButton({
  jobId,
  applyUrl,
  outlineTone = "brand",
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const { isSignedIn } = useAuth();
  const { appliedJobIds, markApplied } = useApplications();
  const router = useRouter();

  const applied = appliedJobIds.has(jobId);
  const track = isSignedIn;

  const openApply = () => {
    const url = applyUrl.trim();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    if (track) {
      void markApplied(jobId);
    }
  };

  if (applied) {
    return (
      <button
        type="button"
        title="View in tracker"
        onClick={() => router.push("/applications")}
        className={cn(
          buttonClassName({
            variant: "outline",
            size,
            outlineTone,
            className: cn(
              "border-emerald-500/40 bg-emerald-500/5 text-emerald-900 hover:bg-emerald-500/10 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100",
              className,
            ),
          }),
        )}
      >
        Applied ✓
      </button>
    );
  }

  const isOutline = variant === "outline";

  return (
    <button
      type="button"
      onClick={openApply}
      className={cn(
        isOutline
          ? buttonClassName({ variant: "outline", size, outlineTone, className })
          : buttonClassName({ variant: "primary", size, className }),
      )}
    >
      {size === "md" ? "Apply now" : "Apply ↗"}
    </button>
  );
}
