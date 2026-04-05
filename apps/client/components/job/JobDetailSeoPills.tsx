import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { Badge } from "../ui/Badge";

const EXP_FILTER = new Set(["junior", "mid", "senior"]);

/**
 * SEO / browse pills for the job detail page. Location and work type are shown in
 * {@link JobHeader}; this row is only experience (and similar) so skills stay separate.
 */
export function JobDetailSeoPills({ job }: { job: JobItem }) {
  const exp = job.experienceLevel?.toLowerCase().trim();
  const experienceHref =
    exp && EXP_FILTER.has(exp) ? `/jobs?experience=${encodeURIComponent(exp)}` : null;

  if (!job.experienceLevel) {
    return null;
  }

  return (
    <nav className="flex flex-wrap gap-2 py-4" aria-label="Browse related jobs">
      <div className="flex w-full min-w-0 flex-wrap gap-2">
        {experienceHref ? (
          <Link href={experienceHref} className="no-underline">
            <Badge tone="brand" caps={false} className="px-3.5 py-1.5 text-xs shadow-sm">
              {job.experienceLevel}
            </Badge>
          </Link>
        ) : (
          <Badge tone="brand" caps={false} className="px-3.5 py-1.5 text-xs shadow-sm">
            {job.experienceLevel}
          </Badge>
        )}
      </div>
    </nav>
  );
}
