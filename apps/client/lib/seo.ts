import type { Metadata } from "next";
import type { JobFilters } from "./slug-parser";

function toTitleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function buildJobsSeo(
  filters: Pick<JobFilters, "role" | "skills" | "country" | "category" | "isRemote" | "workType">,
): {
  title: string;
  description: string;
} {
  const parts: string[] = [];
  const remoteish = filters.workType === "remote" || filters.isRemote;
  if (remoteish) parts.push("Remote");
  if (filters.category) parts.push(toTitleCase(filters.category));
  if (filters.role) parts.push(toTitleCase(filters.role));
  if (filters.skills?.length) {
    parts.push(filters.skills.map((s) => toTitleCase(s)).join(", "));
  }
  parts.push("Jobs");
  if (filters.country) parts.push(`in ${filters.country}`);

  const title = `${parts.join(" ")} | JobSeek`;
  const description =
    filters.role || filters.skills?.length || filters.category
      ? `Find ${remoteish ? "remote " : ""}${filters.category ?? ""} jobs${
          filters.country ? ` (${filters.country})` : ""
        }.`
      : "Browse jobs with category, role, skill, and country filters.";

  return { title, description };
}

export function jobsMetadata(
  filters: Pick<JobFilters, "role" | "skills" | "country" | "category" | "isRemote" | "workType">,
): Metadata {
  const { title, description } = buildJobsSeo(filters);
  return { title, description };
}
