"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { returnPathFromSearchParams, signInWithNext } from "../../lib/signInUrl";

function SignUpBody() {
  const sp = useSearchParams();
  const returnPath = returnPathFromSearchParams((k) => sp.get(k));
  const [forceUrl, setForceUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setForceUrl(new URL(returnPath, window.location.origin).href);
  }, [returnPath]);

  if (forceUrl == null) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Loading sign-up…
      </p>
    );
  }

  return (
    <SignUp
      key={forceUrl}
      signInUrl={signInWithNext(returnPath)}
      forceRedirectUrl={forceUrl}
      fallbackRedirectUrl={forceUrl}
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
