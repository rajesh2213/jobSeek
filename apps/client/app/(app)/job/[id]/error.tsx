"use client";

import Link from "next/link";
import { Container } from "../../../../components/ui/Container";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Transient upstream failures (timeout, 429, 503) — not a missing job. */
export default function JobDetailError({ reset }: Props) {
  return (
    <main className="min-h-screen">
      <Container width="wide" className="py-16 text-center">
        <h1 className="text-2xl font-bold text-ink">Could not load this job</h1>
        <p className="mt-3 text-sm text-ink/70">
          Our job service is temporarily busy. Please try again in a moment.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Try again
          </button>
          <Link
            href="/jobs"
            className="text-sm font-semibold text-brand underline underline-offset-2 hover:text-brand-hover"
          >
            Back to jobs
          </Link>
        </div>
      </Container>
    </main>
  );
}
