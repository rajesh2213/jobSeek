import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { AccentTone } from "./types";

const toneClass: Record<AccentTone, string> = {
  teal: "bg-teal/10 text-teal",
  rose: "bg-rose/10 text-rose",
  amber: "bg-amber/10 text-amber",
  brand: "bg-brand/10 text-brand",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: AccentTone;
  /** Default uppercase for meta chips; false for skill phrases. */
  caps?: boolean;
  children: ReactNode;
}

/** Skill / meta pill (Komposo ~11px bold). */
export function Badge({ tone, caps = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold tracking-wide",
        caps && "uppercase",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
