import type { JobItem } from "./api";

/** Salary years and similar leaks often appear as 4+ digit numeric-only “skills”. */
export function isNumericLeakSkillToken(s: string): boolean {
  return /^\d{4,}$/.test(s.trim());
}

export function filterSkillPillsForDisplay(skills: string[]): string[] {
  return skills.filter((s) => !isNumericLeakSkillToken(s));
}

export function countryLabelForDisplay(code: string): string {
  if (!code || code === "UNKNOWN") return "";
  if (code === "GLOBAL") return "Global";
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Pin line for cards: full country name when possible, else code. */
export function jobCardPinLocationText(job: JobItem): string {
  const code = (job.locationCountry ?? job.country)?.trim() || "";
  if (!code || code === "UNKNOWN") return "Location TBD";
  const label = countryLabelForDisplay(code);
  return label || code;
}

/** Detail header: city + country when city exists. */
export function jobDetailPinLocationText(job: JobItem): string {
  const code = (job.locationCountry ?? job.country)?.trim() || "";
  if (!code || code === "UNKNOWN") return "Location TBD";
  const countryName = countryLabelForDisplay(code) || code;
  const city = job.locationCity?.trim();
  if (city) return `${city}, ${countryName}`;
  return countryName;
}

export function workTypeDisplayLabel(job: JobItem): string {
  const t = job.workType ?? (job.isRemote ? "remote" : "onsite");
  if (t === "remote") return "Remote";
  if (t === "hybrid") return "Hybrid";
  return "On-site";
}
