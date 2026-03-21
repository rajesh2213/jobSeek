import type { AtsCrawler } from "../ats.interface.js";
import { throttleByAts, trimWhitespace } from "../ats.interface.js";
import { parseBambooHrJobs } from "./bamboohr.parser.js";
import type {
  BambooHrApiJob,
  BambooHrApiResponse,
  BambooHrRawJob,
} from "./bamboohr.types.js";

function mapApiJobs(token: string, jobs: BambooHrApiJob[]): BambooHrRawJob[] {
  const mapped: BambooHrRawJob[] = [];
  for (const job of jobs) {
    const id = job.id?.toString();
    const title = trimWhitespace(job.jobOpeningName);
    if (!id || !title) continue;
    mapped.push({
      title,
      location: trimWhitespace(job.location),
      description: trimWhitespace(job.employmentStatusLabel),
      sourceUrl: `https://${token}.bamboohr.com/careers/${id}`,
    });
  }
  return mapped;
}

function parseHtmlJobs(token: string, html: string): BambooHrRawJob[] {
  const jobs: BambooHrRawJob[] = [];
  const linkRegex =
    /<a[^>]+href="([^"]*\/careers\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const href = trimWhitespace(match[1]);
    const text = trimWhitespace(match[2]?.replace(/<[^>]*>/g, " "));
    if (!href || !text) continue;
    const sourceUrl = href.startsWith("http")
      ? href
      : `https://${token}.bamboohr.com${href.startsWith("/") ? "" : "/"}${href}`;
    jobs.push({
      title: text,
      sourceUrl,
      location: undefined,
      description: undefined,
    });
  }
  return jobs;
}

class BambooHrCrawlerImpl implements AtsCrawler<BambooHrRawJob> {
  readonly atsType = "bamboohr" as const;

  async fetchJobs(token: string): Promise<BambooHrRawJob[]> {
    await throttleByAts(this.atsType);
    const url = `https://${token}.bamboohr.com/careers/list`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) {
      throw new Error(`BambooHR request failed (${res.status} ${res.statusText})`);
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as BambooHrApiResponse;
      return mapApiJobs(token, Array.isArray(data.result) ? data.result : []);
    }

    const html = await res.text();
    return parseHtmlJobs(token, html);
  }

  parseJobs(rawJobs: BambooHrRawJob[], companyId: string) {
    return parseBambooHrJobs(rawJobs, companyId);
  }
}

export const bamboohrCrawler = new BambooHrCrawlerImpl();

