import { cn } from "../../lib/cn";

export function ComingSoonPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:border-white/15 dark:bg-white/10 dark:text-white/60",
        className,
      )}
    >
      🔜 Coming soon
    </span>
  );
}
