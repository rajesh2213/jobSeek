import type { AtsCrawler } from "../ats.interface.js";
import { throttleByAts, trimWhitespace } from "../ats.interface.js";
import { parseRipplingJobs } from "./rippling.parser.js";
import type { RipplingRawJob } from "./rippling.types.js";
import { asyncPool } from "../../../utils/asyncPool.js";

function parseJsonEmbeddedJobs(html: string): RipplingRawJob[] {
  const jobs: RipplingRawJob[] = [];
  const scriptRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const payload = trimWhitespace(match[1]);
    if (!payload) continue;
    try {
      const json = JSON.parse(payload) as
        | { title?: string; url?: string; description?: string; datePosted?: string; jobLocation?: { address?: { addressLocality?: string; addressCountry?: string } } }
        | Array<{ title?: string; url?: string; description?: string; datePosted?: string; jobLocation?: { address?: { addressLocality?: string; addressCountry?: string } } }>;
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        jobs.push({
          title: trimWhitespace(item.title),
          sourceUrl: trimWhitespace(item.url),
          description: trimWhitespace(item.description),
          postedAt: trimWhitespace(item.datePosted),
          location: trimWhitespace(
            [item.jobLocation?.address?.addressLocality, item.jobLocation?.address?.addressCountry]
              .filter(Boolean)
              .join(", "),
          ),
        });
      }
    } catch {
      continue;
    }
  }
  return jobs;
}

function parseLinkBasedJobs(token: string, html: string): RipplingRawJob[] {
  const jobs: RipplingRawJob[] = [];
  const linkRegex = /<a[^>]+href="([^"]*\/jobs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const href = trimWhitespace(match[1]);
    const text = trimWhitespace(match[2]?.replace(/<[^>]*>/g, " "));
    if (!href || !text) continue;
    jobs.push({
      title: text,
      sourceUrl: href.startsWith("http")
        ? href
        : `https://ats.rippling.com/${token}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  return jobs;
}

async function enrichRipplingJobDetail(raw: RipplingRawJob): Promise<RipplingRawJob> {
  if (!raw.sourceUrl) return raw;
  try {
    const res = await fetch(raw.sourceUrl, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return raw;
    const html = await res.text();
    const jsonJobs = parseJsonEmbeddedJobs(html);
    const found = jsonJobs.find((j) => j.sourceUrl === raw.sourceUrl) ?? jsonJobs[0];
    if (!found) return raw;
    return {
      ...raw,
      description: found.description ?? raw.description,
      postedAt: found.postedAt ?? raw.postedAt,
      location: found.location ?? raw.location,
    };
  } catch {
    return raw;
  }
}

class RipplingCrawlerImpl implements AtsCrawler<RipplingRawJob> {
  readonly atsType = "rippling" as const;

  async fetchJobs(token: string): Promise<RipplingRawJob[]> {
    await throttleByAts(this.atsType);
    const url = `https://ats.rippling.com/${token}/jobs`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) {
      throw new Error(`Rippling request failed (${res.status} ${res.statusText})`);
    }
    const html = await res.text();
    const jsonJobs = parseJsonEmbeddedJobs(html).filter((job) => job.title && job.sourceUrl);
    if (jsonJobs.length > 0) return jsonJobs;
    const linkJobs = parseLinkBasedJobs(token, html);
    const needsDetail = linkJobs.filter((j) => !j.description || !j.postedAt).slice(0, 10);
    if (needsDetail.length === 0) return linkJobs;

    const enriched = await asyncPool(needsDetail, 3, (j) => enrichRipplingJobDetail(j));
    const byUrl = new Map(enriched.filter((x) => x.sourceUrl).map((x) => [x.sourceUrl!, x]));
    return linkJobs.map((j) => (j.sourceUrl && byUrl.has(j.sourceUrl) ? byUrl.get(j.sourceUrl)! : j));
  }

  parseJobs(rawJobs: RipplingRawJob[], companyId: string) {
    return parseRipplingJobs(rawJobs, companyId);
  }
}

export const ripplingCrawler = new RipplingCrawlerImpl();

