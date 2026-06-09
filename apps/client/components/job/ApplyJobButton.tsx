"use client";

import { useAuth } from "@clerk/nextjs";
import type { AccentTone } from "../ui/types";
import { useApplications } from "../../lib/applicationsContext";
import { trackJobApplyClicked } from "../../lib/analytics/resumeMatchFunnel";
import { resolveFitSurface, type FitSurface } from "../../lib/analytics/fitSurface";
import { captureEvent, withPosthogAttribution } from "../../lib/posthog";
import { buttonClassName } from "../ui/Button";
import { cn } from "../../lib/cn";

interface Props {
  jobId: string;
  /** Company display name for analytics */
  company: string;
  /** Where the apply CTA lives, e.g. `job_detail_header` or `job_card` */
  source: string;
  /** Phase 8C experiment surface for funnel attribution */
  surface?: FitSurface;
  applyUrl: string;
  /** Card accent for outline Apply button */
  outlineTone?: AccentTone;
  size?: "sm" | "md";
  variant?: "primary" | "outline";
  className?: string;
}

export function ApplyJobButton({
  jobId,
  company,
  source,
  surface: surfaceProp,
  applyUrl,
  outlineTone = "brand",
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const { isSignedIn } = useAuth();
  const { markApplied } = useApplications();
  const track = isSignedIn;

  const openApply = () => {
    const url = applyUrl.trim();
    if (!url) return;
    const surface = resolveFitSurface(jobId, surfaceProp);
    trackJobApplyClicked({ jobId, surface, source });
    captureEvent(
      "job_apply_clicked",
      withPosthogAttribution({
        jobId,
        company,
        source,
        surface,
        isAuthenticated: Boolean(isSignedIn),
      }),
    );
    if (track) {
      try {
        const current = new URL(window.location.href);
        current.searchParams.set("appliedJob", jobId);
        window.history.replaceState(null, "", current.toString());
        window.sessionStorage.setItem("jobseek:applied-flash-job-id", jobId);
      } catch {
        // Non-blocking marker; external apply should still open.
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
    if (track) {
      void markApplied(jobId);
    }
  };

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
