import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Full-viewport-wide primary column under the fixed desktop rail (the rail paints above with
 * higher z-index). Apply `DESKTOP_RAIL_INSET_CLASS` from `railInset.ts` only on inner rows that
 * must clear the rail — never on this element — so footer and full-bleed bands can span `x = 0`
 * like the header.
 */
export function RailMainSurface({ children, className }: Props) {
  return (
    <main className={cn("relative flex min-h-0 w-full flex-1 flex-col", className)}>
      {children}
    </main>
  );
}
