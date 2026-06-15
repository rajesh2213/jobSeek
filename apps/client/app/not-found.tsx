import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found | JobLoom",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-extrabold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-ink/70">
          This page is unavailable or the link may be outdated.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/jobs"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Browse jobs
          </Link>
          <Link href="/" className="text-sm font-semibold text-brand hover:underline">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
