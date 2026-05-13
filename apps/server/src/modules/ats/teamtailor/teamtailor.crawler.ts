import type { AtsCrawler } from "../ats.interface.js";
import {
  fetchJsonWithTimeout,
  throttleByAts,
  trimWhitespace,
} from "../ats.interface.js";
import { parseTeamtailorJobs } from "./teamtailor.parser.js";
import type { TeamtailorApiResponse, TeamtailorJob } from "./teamtailor.types.js";
import { asyncPool } from "../../../utils/asyncPool.js";
import { extractJobDescriptionFromHtml, extractSalaryFromJobPostingJsonLd } from "../../../utils/jobDetailHtml.js";

function extractPostedAtFromJsonLd(html: string): string | undefined {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const type = obj["@type"];
        const types = Array.isArray(type) ? type : [type];
        const isJP = types.some((t) =>
          String(t ?? "").toLowerCase().includes("jobposting"),
        );
        if (!isJP) continue;
        const dp = obj["datePosted"] ?? obj["postedAt"] ?? obj["validFrom"];
        if (typeof dp === "string" && dp.trim()) return dp.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseFallbackHtml(token: string, html: string): TeamtailorJob[] {
  const jobs: TeamtailorJob[] = [];
  const linkRegex = /href="([^"]*\/jobs\/[^"]+)"/gi;
  for (const match of html.matchAll(linkRegex)) {
    const href = trimWhitespace(match[1]);
    if (!href) continue;
    const slug = href.split("/").filter(Boolean).pop();
    const title = slug
      ? slug
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase())
      : undefined;
    const fullUrl = href.startsWith("http")
      ? href
      : `https://${token}.teamtailor.com${href.startsWith("/") ? "" : "/"}${href}`;
    jobs.push({
      id: slug,
      type: "jobs",
      attributes: {
        title,
        body: undefined,
        external_application_url: fullUrl,
      },
    });
  }
  return jobs;
}

class TeamtailorCrawlerImpl implements AtsCrawler<TeamtailorJob> {
  readonly atsType = "teamtailor" as const;

  async fetchJobs(token: string): Promise<TeamtailorJob[]> {
    await throttleByAts(this.atsType);
    const apiUrl = `https://api.teamtailor.com/v1/jobs?filter[site]=${encodeURIComponent(token)}`;
    try {
      const data = await fetchJsonWithTimeout<TeamtailorApiResponse>(apiUrl, 7000);
      return Array.isArray(data.data) ? data.data : [];
    } catch {
      const fallbackUrl = `https://${token}.teamtailor.com/jobs`;
      const res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) {
        throw new Error(`Teamtailor request failed (${res.status} ${res.statusText})`);
      }
      const html = await res.text();
      const fallbackJobs = parseFallbackHtml(token, html);

      const needsDetail = fallbackJobs
        .filter((j) => !j.attributes?.body && j.attributes?.external_application_url)
        .slice(0, 12);

      if (needsDetail.length === 0) return fallbackJobs;

      const enriched = await asyncPool(needsDetail, 3, async (job) => {
        const url = job.attributes?.external_application_url;
        if (!url) return job;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
          if (!r.ok) return job;
          const detailHtml = await r.text();
          const extracted = extractJobDescriptionFromHtml(detailHtml);
          const postedAt = extractPostedAtFromJsonLd(detailHtml);
          const salary = extractSalaryFromJobPostingJsonLd(detailHtml);

          return {
            ...job,
            attributes: {
              ...job.attributes,
              body: extracted.text || job.attributes?.body,
              created_at: postedAt || job.attributes?.created_at,
              salary: salary ?? job.attributes?.salary,
            },
          };
        } catch {
          return job;
        }
      });

      const byId = new Map<string, TeamtailorJob>();
      for (const j of enriched) {
        if (j.id) byId.set(j.id, j);
      }
      return fallbackJobs.map((j) => {
        const key = j.id;
        return key && byId.has(key) ? (byId.get(key) as TeamtailorJob) : j;
      });
    }
  }

  parseJobs(rawJobs: TeamtailorJob[], companyId: string) {
    return parseTeamtailorJobs(rawJobs, companyId);
  }
}

export const teamtailorCrawler = new TeamtailorCrawlerImpl();

