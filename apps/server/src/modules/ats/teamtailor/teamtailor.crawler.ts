import type { AtsCrawler } from "../ats.interface.js";
import {
  fetchJsonWithTimeout,
  throttleByAts,
  trimWhitespace,
} from "../ats.interface.js";
import { parseTeamtailorJobs } from "./teamtailor.parser.js";
import type { TeamtailorApiResponse, TeamtailorJob } from "./teamtailor.types.js";

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
      return parseFallbackHtml(token, html);
    }
  }

  parseJobs(rawJobs: TeamtailorJob[], companyId: string) {
    return parseTeamtailorJobs(rawJobs, companyId);
  }
}

export const teamtailorCrawler = new TeamtailorCrawlerImpl();

