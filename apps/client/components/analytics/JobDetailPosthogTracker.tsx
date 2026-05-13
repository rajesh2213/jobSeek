"use client";

import {
  captureEvent,
  usePosthogStableMicrotask,
  withPosthogAttribution,
} from "../../lib/posthog";

interface Props {
  jobId: string;
  company: string;
  location: string | null;
  remote: boolean;
  /** e.g. `job_detail_page` */
  source: string;
}

/**
 * Fires `job_viewed` once per stable mount for a given `jobId` (StrictMode-safe).
 */
export function JobDetailPosthogTracker({ jobId, company, location, remote, source }: Props) {
  usePosthogStableMicrotask(() => {
    captureEvent(
      "job_viewed",
      withPosthogAttribution({
        jobId,
        company,
        location: location ?? "",
        remote,
        source,
      }),
    );
  }, [jobId, company, location, remote, source]);

  return null;
}
