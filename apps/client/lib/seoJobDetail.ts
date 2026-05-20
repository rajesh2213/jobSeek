import type { JobItem } from "./api";
import { countryLabelForDisplay, jobDetailPinLocationText, workTypeDisplayLabel } from "./jobDisplay";

const BRAND_SUFFIX = "| JobLoom";
/** Pixel-approximate safe cap; Google truncates ~50–60 chars visually. */
const TITLE_MAX_CORE = 72;

function compactSalaryPhrase(job: JobItem): string | null {
  const min = job.salaryMin;
  if (min != null && min > 0) {
    if (min >= 1000) return `from $${Math.round(min / 1000)}k`;
    return `from $${min.toLocaleString()}`;
  }
  return null;
}

/**
 * Length-capped job detail <title> / OG title: primary role signal, work mode, employer, optional geo & salary.
 */
export function buildJobDetailSeo(
  job: JobItem,
  options?: { plainDescriptionForSeo?: string },
): { title: string; description: string } {
  const company = job.company?.name?.trim() || "Company";
  const work = workTypeDisplayLabel(job);
  const loc = jobDetailPinLocationText(job);
  const salaryBit = compactSalaryPhrase(job);

  const segments: string[] = [job.title.trim(), company];
  const countryCode = (job.locationCountry ?? job.country)?.trim() || "";
  const countryOnly =
    countryCode && countryCode !== "UNKNOWN" ? countryLabelForDisplay(countryCode) : null;

  let locForTitle = loc;
  let core = `${segments.join(" at ")} · ${[work, locForTitle, salaryBit].filter(Boolean).join(" · ")}`;
  if (core.length > TITLE_MAX_CORE && loc && loc.includes(",") && countryOnly) {
    locForTitle = countryOnly;
    core = `${segments.join(" at ")} · ${[work, locForTitle, salaryBit].filter(Boolean).join(" · ")}`;
  }
  if (core.length > TITLE_MAX_CORE) {
    core = `${job.title.trim()} at ${company} · ${work}`;
  }
  if (core.length > TITLE_MAX_CORE) {
    core = `${job.title.trim()} at ${company}`;
  }
  if (core.length > TITLE_MAX_CORE) {
    const budget = TITLE_MAX_CORE - "…".length - ` at ${company}`.length;
    const head = job.title.trim().slice(0, Math.max(12, budget));
    core = `${head}… at ${company}`;
  }

  const title = `${core} ${BRAND_SUFFIX}`.replace(/\s+/g, " ").trim();

  const primaryPlain =
    options?.plainDescriptionForSeo?.trim().replace(/\s+/g, " ") ?? "";
  let description =
    (primaryPlain ? primaryPlain.slice(0, 155).trim() : structuredPlainFallback(job).slice(0, 155).trim()) ||
    `View ${job.title} at ${company}—apply via the employer career page.`;

  if (job.freshness?.source === "POSTED" && job.freshness.relative) {
    const suffix = ` ${job.freshness.relative}.`;
    if (description.length + suffix.length <= 160) {
      description = `${description}${suffix}`;
    }
  } else if (!description.endsWith(".")) {
    description = `${description}. Direct from company career sites.`;
    if (description.length > 160) {
      description = description.slice(0, 157).trimEnd() + "…";
    }
  }

  return { title, description };
}

function structuredPlainFallback(job: JobItem): string {
  const fromEnriched = job.enriched?.salary?.trim();
  if (fromEnriched) return `${job.title} at ${job.company.name}. ${fromEnriched}.`;
  const d = job.description?.trim();
  if (d) return d.replace(/\s+/g, " ");
  return "";
}
