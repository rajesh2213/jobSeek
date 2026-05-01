import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DESKTOP_RAIL_INSET_CLASS } from "../layout/railInset";

/** Shared layout and typography for legal documents (template copy — have counsel review). */
export function LegalPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-h-screen bg-canvas pb-24 pt-10 text-ink", DESKTOP_RAIL_INSET_CLASS)}>
      <div className="mx-auto w-[90%] max-w-readable px-4">
        <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{description}</p>
        ) : null}
        <article className="mt-10 space-y-6 text-sm leading-relaxed text-ink/90 [&_h2]:scroll-mt-24 [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ink [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_li]:pl-0.5 [&_strong]:text-ink">
          {children}
        </article>
      </div>
    </div>
  );
}
