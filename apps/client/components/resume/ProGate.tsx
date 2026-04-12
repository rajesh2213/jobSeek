"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAccountPlan } from "../../lib/useAccountPlan";

const copy: Record<string, string> = {
  "missing-keywords":
    "Upgrade to Pro to see missing keywords and suggested edits",
  "copy-keywords": "Upgrade to Pro to copy missing keywords",
  "download-docx": "Upgrade to Pro to download an optimized Word document",
};

export function ProGate({
  feature,
  children,
}: {
  feature: keyof typeof copy | string;
  children: ReactNode;
}) {
  const { isPro, isLoaded } = useAccountPlan();

  if (!isLoaded) {
    return <>{children}</>;
  }

  if (isPro) {
    return <>{children}</>;
  }

  const message = copy[feature] ?? "Upgrade to Pro to unlock this feature";

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-surface/80 p-4 text-center backdrop-blur-[2px]">
        <p className="max-w-[260px] text-sm font-medium text-ink">{message}</p>
        <Link
          href="/pricing"
          className="pointer-events-auto rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-hover"
        >
          Upgrade to Pro →
        </Link>
      </div>
    </div>
  );
}
