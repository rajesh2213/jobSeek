import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { AccentTone } from "./types";

const rail: Record<AccentTone, string> = {
  teal: "bg-teal",
  rose: "bg-rose",
  amber: "bg-amber",
  brand: "bg-brand",
};

const borderHover: Record<AccentTone, string> = {
  teal: "hover:border-teal/40 hover:shadow-card-hover",
  rose: "hover:border-rose/40 hover:shadow-card-hover",
  amber: "hover:border-amber/40 hover:shadow-card-hover",
  brand: "hover:border-brand/40 hover:shadow-card-hover",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  accent: AccentTone;
  children: ReactNode;
  as?: "article" | "div";
}

/**
 * Komposo job-card shell: white surface, subtle border, left hover rail.
 */
export function Card({
  accent,
  children,
  className,
  as: Tag = "article",
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-ink/5 bg-surface p-7 shadow-card transition-all duration-300",
        borderHover[accent],
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 h-full w-1 rounded-r opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          rail[accent],
        )}
        aria-hidden
      />
      {children}
    </Tag>
  );
}
