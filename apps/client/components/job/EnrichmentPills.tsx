import Link from "next/link";
import type { JobItem } from "../../lib/api";
import { formatSalaryUsd } from "../../lib/format";
import { isNumericLeakSkillToken } from "../../lib/jobDisplay";
import { Badge } from "../ui/Badge";

function mergeTechTags(job: JobItem): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...(job.enriched?.techStack ?? []), ...(job.skills ?? [])]) {
    const t = s.trim();
    if (!t || isNumericLeakSkillToken(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * Skills + compensation only. Work location / arrangement lives in "Browse related jobs"
 * so we do not duplicate Remote / Hybrid / On-site here.
 */
export function EnrichmentPills({ job }: { job: JobItem }) {
  const skills = mergeTechTags(job);
  const salary =
    job.enriched?.salary?.trim() ||
    (job.salaryMin != null && job.salaryMin > 0 ? formatSalaryUsd(job.salaryMin) : null);

  if (skills.length === 0 && !salary) {
    return null;
  }

  return (
    <div className="mb-4 w-full min-w-0 max-w-full border-b border-ink/10 pb-4" aria-label="Role highlights">
      <div className="flex flex-wrap items-center gap-2">
        {skills.map((s) => (
          <Link
            key={`sk-${s}`}
            href={`/jobs?skills=${encodeURIComponent(s)}`}
            className="no-underline"
          >
            <Badge tone="brand" caps={false} className="max-w-[200px] truncate">
              {s}
            </Badge>
          </Link>
        ))}
        {salary ? (
          <Badge tone="amber" caps={false} className="max-w-[280px] truncate">
            {salary}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
