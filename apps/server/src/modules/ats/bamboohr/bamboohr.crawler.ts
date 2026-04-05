import type { AtsCrawler } from "../ats.interface.js";
import { throttleByAts, trimWhitespace } from "../ats.interface.js";
import { parseBambooHrJobs } from "./bamboohr.parser.js";
import type {
  BambooHrApiJob,
  BambooHrApiResponse,
  BambooHrRawJob,
} from "./bamboohr.types.js";
import { asyncPool } from "../../../utils/asyncPool.js";
import { extractJobDescriptionFromHtml } from "../../../utils/jobDetailHtml.js";

function extractPostedAtFromJsonLd(html: string): string | undefined {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const raw = trimWhitespace(match[1]);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const items = Array.isArray(data) ? data : [data as unknown];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const type = obj["@type"];
        const types = Array.isArray(type) ? type : [type];
        const isJobPosting = types.some((t) =>
          String(t ?? "").toLowerCase().includes("jobposting"),
        );
        if (!isJobPosting) {
          const graph = obj["@graph"];
          if (Array.isArray(graph)) {
            for (const g of graph) {
              if (g && typeof g === "object") {
                const go = g as Record<string, unknown>;
                const t2 = go["@type"];
                const tarr = Array.isArray(t2) ? t2 : [t2];
                const isJP = tarr.some((t) =>
                  String(t ?? "").toLowerCase().includes("jobposting"),
                );
                if (!isJP) continue;
                const dp = go["datePosted"] ?? go["postedAt"] ?? go["validFrom"];
                if (typeof dp === "string" && dp.trim()) return dp.trim();
              }
            }
          }
          continue;
        }
        const dp = obj["datePosted"] ?? obj["postedAt"] ?? obj["validFrom"];
        if (typeof dp === "string" && dp.trim()) return dp.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function mapApiJobs(token: string, jobs: BambooHrApiJob[]): BambooHrRawJob[] {
  const mapped: BambooHrRawJob[] = [];
  for (const job of jobs) {
    const id = job.id?.toString();
    const title = trimWhitespace(job.jobOpeningName);
    if (!id || !title) continue;
    const maybeDesc = trimWhitespace(job.employmentStatusLabel);
    mapped.push({
      id,
      title,
      location: trimWhitespace(job.location),
      description: maybeDesc && maybeDesc.length >= 120 ? maybeDesc : undefined,
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
    let rawJobs: BambooHrRawJob[];
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as BambooHrApiResponse;
      rawJobs = mapApiJobs(token, Array.isArray(data.result) ? data.result : []);
    } else {
      const html = await res.text();
      rawJobs = parseHtmlJobs(token, html);
    }

    const needsDetail = rawJobs
      .filter((j) => !j.description || j.description.trim().length < 120)
      .slice(0, 12);
    if (needsDetail.length === 0) return rawJobs;

    const enriched = await asyncPool(needsDetail, 3, async (job) => {
      if (!job.sourceUrl) return job;
      try {
        const r = await fetch(job.sourceUrl, { signal: AbortSignal.timeout(7000) });
        if (!r.ok) return job;
        const html = await r.text();
        const extracted = extractJobDescriptionFromHtml(html);
        const postedAt = extractPostedAtFromJsonLd(html);
        return {
          ...job,
          description: extracted.text && extracted.text.trim().length > 0 ? extracted.text : job.description,
          postedAt: postedAt ?? job.postedAt,
        };
      } catch {
        return job;
      }
    });

    const byUrl = new Map(enriched.filter((x) => x.sourceUrl).map((x) => [x.sourceUrl!, x]));
    return rawJobs.map((j) => (j.sourceUrl && byUrl.has(j.sourceUrl) ? byUrl.get(j.sourceUrl)! : j));
  }

  parseJobs(rawJobs: BambooHrRawJob[], companyId: string) {
    return parseBambooHrJobs(rawJobs, companyId);
  }
}

export const bamboohrCrawler = new BambooHrCrawlerImpl();

