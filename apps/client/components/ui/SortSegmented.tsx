import { cn } from "../../lib/cn";

export interface SortSegmentedProps {
  value: "latest" | "salary_desc";
  onChange: (next: "latest" | "salary_desc") => void;
  totalRoles?: number;
  className?: string;
}

function formatRoleCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** Segmented control: raised “pill” for the active option (tablet-style switch). */
export function SortSegmented({ value, onChange, totalRoles, className }: SortSegmentedProps) {
  return (
    <div className={cn("flex w-full flex-wrap items-center justify-between gap-3", className)}>
      <div
        className="inline-flex rounded-full bg-ink/10 p-1 shadow-inner ring-1 ring-ink/10"
        role="tablist"
        aria-label="Sort results"
      >
        <button
          type="button"
          role="tab"
          aria-selected={value === "latest"}
          onClick={() => onChange("latest")}
          className={cn(
            "relative rounded-full px-4 py-2 text-xs font-bold tracking-wide transition-[color,background-color,box-shadow,transform] duration-200 ease-out",
            value === "latest"
              ? "bg-surface text-ink shadow-md ring-1 ring-ink/8"
              : "text-ink/45 hover:text-ink/75 active:scale-[0.98]",
          )}
        >
          Latest
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === "salary_desc"}
          onClick={() => onChange("salary_desc")}
          className={cn(
            "relative rounded-full px-4 py-2 text-xs font-bold tracking-wide transition-[color,background-color,box-shadow,transform] duration-200 ease-out",
            value === "salary_desc"
              ? "bg-surface text-ink shadow-md ring-1 ring-ink/8"
              : "text-ink/45 hover:text-ink/75 active:scale-[0.98]",
          )}
        >
          Highest salary
        </button>
      </div>
      {totalRoles != null && (
        <p className="text-xs font-bold uppercase tracking-wider text-ink/35">
          <span className="text-sm text-ink/70">{formatRoleCount(totalRoles)}</span> roles
        </p>
      )}
    </div>
  );
}
