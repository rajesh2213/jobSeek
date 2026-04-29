"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { EmailCaptureCard } from "../email/EmailCaptureCard";

const DELAY_MS = 5000;

/** Fixed corner capture shown once per session after browsing the jobs listing for a few seconds. */
export function JobsListingEmailCapturePopup() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [open, setOpen] = useState(false);

  const signedInWithEmail = Boolean(
    isSignedIn &&
      (user?.primaryEmailAddress?.emailAddress || (user?.emailAddresses?.length ?? 0) > 0),
  );

  useEffect(() => {
    if (!isLoaded || signedInWithEmail) return;
    const id = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(id);
  }, [isLoaded, signedInWithEmail]);

  function persistDismiss() {
    setOpen(false);
  }

  function onSubscribeSuccess() {
    window.setTimeout(() => setOpen(false), 2400);
  }

  if (!open || !isLoaded || signedInWithEmail) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,420px)] rounded-2xl border border-ink/10 bg-canvas p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink/70">Stay ahead</p>
        <button
          type="button"
          onClick={persistDismiss}
          className="text-xs text-ink/50 hover:text-ink"
        >
          close
        </button>
      </div>
      <EmailCaptureCard
        source="jobs_listing"
        title="Don't miss new jobs"
        subtitle="Get a daily shortlist in your inbox."
        onSubscribeSuccess={onSubscribeSuccess}
      />
    </div>
  );
}
