"use client";

import Link from "next/link";
import { Button } from "./Button";
import { Card } from "./Card";

interface Props {
  onTryRemote?: () => void;
  onClearCountry?: () => void;
}

export function EmptyState({ onTryRemote, onClearCountry }: Props) {
  return (
    <Card accent="teal" className="mx-auto max-w-lg text-center" as="div" role="status">
      <div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand/20 to-teal/10 text-3xl shadow-sm"
        aria-hidden
      >
        ◇
      </div>
      <h2 className="text-2xl font-extrabold tracking-tight text-ink">Nothing here yet</h2>
      <p className="mt-3 text-base leading-relaxed text-ink/55">
        Widen a filter or use a shortcut — listings stay deduped so the signal stays high.
      </p>
      <ul className="mt-8 flex w-full max-w-xs flex-col gap-3 text-left text-sm">
        {onTryRemote && (
          <li>
            <Button variant="outline" outlineTone="teal" size="md" className="w-full" onClick={onTryRemote}>
              → Remote-friendly roles
            </Button>
          </li>
        )}
        {onClearCountry && (
          <li>
            <Button variant="outline" outlineTone="rose" size="md" className="w-full" onClick={onClearCountry}>
              → All countries
            </Button>
          </li>
        )}
        <li className="px-1 py-2 text-center text-ink/50">
          Or browse{" "}
          <Link
            href="/companies"
            className="font-semibold text-brand underline decoration-brand/25 underline-offset-2"
          >
            companies
          </Link>
        </li>
      </ul>
    </Card>
  );
}
