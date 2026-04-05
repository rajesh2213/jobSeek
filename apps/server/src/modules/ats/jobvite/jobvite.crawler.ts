import type { AtsCrawler } from "../ats.interface.js";
import {
  throttleByAts,
  trimWhitespace,
} from "../ats.interface.js";
import { parseJobviteJobs } from "./jobvite.parser.js";
import type { JobviteJsonLdJobPosting, JobviteRawJob } from "./jobvite.types.js";
import { asyncPool } from "../../../utils/asyncPool.js";

function extractJsonLdJobPostings(html: string): JobviteRawJob[] {
  const jobs: JobviteRawJob[] = [];
  const scriptRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const payload = trimWhitespace(match[1]);
    if (!payload) continue;
    try {
      const json = JSON.parse(payload) as
        | JobviteJsonLdJobPosting
        | JobviteJsonLdJobPosting[]
        | { "@graph"?: unknown };

      const items = Array.isArray(json)
        ? json
        : (json as { [k: string]: unknown })["@graph"]
          ? ((json as Record<string, unknown>)["@graph"] as unknown[] | undefined) ??
            []
          : [json as JobviteJsonLdJobPosting];

      for (const item of items) {
        const j = item as JobviteJsonLdJobPosting;
        const title = trimWhitespace(j.title);
        const url = trimWhitespace(j.url);
        if (!title || !url) continue;

        jobs.push({
          title,
          sourceUrl: url,
          description: j.description ? trimWhitespace(j.description) : undefined,
          postedAt: j.datePosted ? trimWhitespace(j.datePosted) : undefined,
          location: trimWhitespace(
            [
              j.jobLocation?.address?.addressLocality,
              j.jobLocation?.address?.addressCountry,
            ]
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

function extractJobviteLinks(html: string, token: string): JobviteRawJob[] {
  const jobs: JobviteRawJob[] = [];
  const linkRegex = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\/jobs\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const href = trimWhitespace(match[1]);
    const rawText = match[2]?.replace(/<[^>]*>/g, " ");
    const title = trimWhitespace(rawText);
    if (!href || !title) continue;

    const sourceUrl = href.startsWith("http")
      ? href
      : `https://jobs.jobvite.com/${token}${href.startsWith("/") ? "" : "/"}${href}`;

    jobs.push({ title, sourceUrl });
  }
  return jobs;
}

async function enrichJobviteJobDetail(raw: JobviteRawJob): Promise<JobviteRawJob> {
  if (!raw.sourceUrl) return raw;
  try {
    const res = await fetch(raw.sourceUrl, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return raw;
    const html = await res.text();
    const jsonLd = extractJsonLdJobPostings(html);
    const found = jsonLd.find((j) => j.sourceUrl === raw.sourceUrl);
    if (!found) return raw;
    return { ...raw, description: found.description, postedAt: found.postedAt, location: found.location };
  } catch {
    return raw;
  }
}

class JobviteCrawlerImpl implements AtsCrawler<JobviteRawJob> {
  readonly atsType = "jobvite" as const;

  async fetchJobs(token: string): Promise<JobviteRawJob[]> {
    await throttleByAts(this.atsType);

    const candidates = [
      `https://jobs.jobvite.com/${token}`,
      `https://jobs.jobvite.com/${token}/jobs`,
    ];

    let lastErr: unknown = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
        if (!res.ok) throw new Error(`Jobvite request failed (${res.status} ${res.statusText})`);
        const html = await res.text();

        const jsonLdJobs = extractJsonLdJobPostings(html);
        if (jsonLdJobs.length > 0) return jsonLdJobs;

        const linkJobs = extractJobviteLinks(html, token);
        if (linkJobs.length === 0) return [];

        const needsDetail = linkJobs.filter((j) => !j.description || !j.postedAt).slice(0, 10);
        if (needsDetail.length > 0) {
          const enriched = await asyncPool(
            needsDetail,
            3,
            (j) => enrichJobviteJobDetail(j),
          );
          const byUrl = new Map(enriched.filter((x) => x.sourceUrl).map((x) => [x.sourceUrl!, x]));
          return linkJobs.map((j) => (j.sourceUrl && byUrl.has(j.sourceUrl) ? byUrl.get(j.sourceUrl)! : j));
        }
        return linkJobs;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("Jobvite fetch failed");
  }

  parseJobs(rawJobs: JobviteRawJob[], companyId: string) {
    return parseJobviteJobs(rawJobs, companyId);
  }
}

export const jobviteCrawler = new JobviteCrawlerImpl();

