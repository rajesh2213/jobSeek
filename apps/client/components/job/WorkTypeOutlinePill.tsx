import type { JobItem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { workTypeDisplayLabel } from "../../lib/jobDisplay";

const CORAL = "#E8533A";

interface Props {
  job: JobItem;
  className?: string;
}

export function WorkTypeOutlinePill({ job, className }: Props) {
  const t = job.workType ?? (job.isRemote ? "remote" : "onsite");
  const isRemote = t === "remote";
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight",
        !isRemote && "border-ink/25 text-ink/55",
        className,
      )}
      style={isRemote ? { borderColor: CORAL, color: CORAL } : undefined}
    >
      {workTypeDisplayLabel(job)}
    </span>
  );
}
