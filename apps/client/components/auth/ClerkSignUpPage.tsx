"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function isSafePath(path: string): path is `/${string}` {
  return path.startsWith("/") && !path.startsWith("//");
}

function SignUpBody() {
  const sp = useSearchParams();
  const raw = sp.get("redirect_url");
  const after =
    raw && isSafePath(decodeURIComponent(raw)) ? decodeURIComponent(raw) : "/jobs";

  return (
    <SignUp
      signInUrl="/sign-in"
      forceRedirectUrl={after}
      fallbackRedirectUrl={after}
    />
  );
}

export function ClerkSignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-ink/8 bg-white/80 px-4 py-4">
        <Link
          href="/jobs"
          className="text-sm font-semibold text-ink/80 hover:text-brand"
        >
          ← Back to jobs
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 py-10">
        <Suspense
          fallback={
            <p className="text-sm text-ink-muted" role="status">
              Loading sign-up…
            </p>
          }
        >
          <SignUpBody />
        </Suspense>
      </div>
    </div>
  );
}
