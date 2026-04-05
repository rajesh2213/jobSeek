import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import type { AccentTone } from "./types";

const accentClass: Record<AccentTone, string> = {
  teal: "border-teal/30 text-teal hover:border-teal focus:border-teal focus:ring-teal/15",
  rose: "border-rose/30 text-rose hover:border-rose focus:border-rose focus:ring-rose/15",
  brand: "border-brand/30 text-brand hover:border-brand focus:border-brand focus:ring-brand/15",
  amber: "border-amber/30 text-amber hover:border-amber focus:border-amber focus:ring-amber/15",
};

export interface FilterSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  accent: AccentTone;
  /** Visually hidden label text for id */
  label: string;
  id: string;
}

/** Komposo pill select: full uppercase tracking, rounded-full. */
export function FilterSelect({ accent, label, id, className, children, ...rest }: FilterSelectProps) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="filter-chip transition-all duration-300 ease-chip hover:-translate-y-0.5 hover:scale-[1.03] active:translate-y-0 active:scale-[0.97]">
        <select
          id={id}
          className={cn(
            "w-full cursor-pointer appearance-none rounded-full border-2 bg-surface py-2.5 pl-4 pr-8 text-xs font-bold uppercase tracking-wide shadow-sm transition-all focus:outline-none focus:ring-2",
            accentClass[accent],
            className,
          )}
          {...rest}
        >
          {children}
        </select>
      </div>
    </>
  );
}
