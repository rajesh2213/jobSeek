import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";

export type BoardProbeResult = "ok" | "empty" | "not_found" | "unparseable" | "error";

export async function probeBoardLive(
  atsType: string,
  token: string,
  careersUrl?: string | null,
): Promise<{ result: BoardProbeResult; jobCount: number }> {
  const parsed = parseCrawlableBoard(atsType as AtsType, token, careersUrl ?? null);
  if (!parsed) return { result: "unparseable", jobCount: 0 };

  try {
    if (atsType === "lever") {
      const r = await fetch(`https://api.lever.co/v0/postings/${parsed.slug}?mode=json`, {
        headers: { "User-Agent": "JobLoom/1.0" },
      });
      if (r.status === 404) return { result: "not_found", jobCount: 0 };
      if (!r.ok) return { result: "error", jobCount: 0 };
      const jobs = (await r.json()) as unknown[];
      const n = Array.isArray(jobs) ? jobs.length : 0;
      return { result: n > 0 ? "ok" : "empty", jobCount: n };
    }

    if (atsType === "greenhouse") {
      const r = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${parsed.slug}/jobs`,
        { headers: { "User-Agent": "JobLoom/1.0" } },
      );
      if (r.status === 404) return { result: "not_found", jobCount: 0 };
      if (!r.ok) return { result: "error", jobCount: 0 };
      const body = (await r.json()) as { jobs?: unknown[] };
      const n = body.jobs?.length ?? 0;
      return { result: n > 0 ? "ok" : "empty", jobCount: n };
    }

    if (atsType === "ashby") {
      const r = await fetch("https://api.ashbyhq.com/posting-api/job-board/" + parsed.slug, {
        headers: { "User-Agent": "JobLoom/1.0" },
      });
      if (r.status === 404) return { result: "not_found", jobCount: 0 };
      if (!r.ok) return { result: "error", jobCount: 0 };
      const body = (await r.json()) as { jobs?: unknown[] };
      const n = body.jobs?.length ?? 0;
      return { result: n > 0 ? "ok" : "empty", jobCount: n };
    }

    return { result: "unparseable", jobCount: 0 };
  } catch {
    return { result: "error", jobCount: 0 };
  }
}

export function extractTokenFromHtml(
  atsType: string,
  html: string,
  careersUrl: string | null,
): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  return null;
}

export async function reextractTokenFromCareersUrl(
  atsType: string,
  careersUrl: string,
): Promise<{ token: string | null; fetched: boolean }> {
  const meta = await fetchCareersHtmlWithMeta(careersUrl, 12_000);
  const html = meta.html ?? "";
  if (!meta.fetched || html.length < 500) return { token: null, fetched: false };
  const token = extractTokenFromHtml(atsType, html, careersUrl);
  if (!token) return { token: null, fetched: true };
  const crawlable = parseCrawlableBoard(atsType as AtsType, token, careersUrl);
  return { token: crawlable ? token : null, fetched: true };
}

export function mergeDiscoveryTag(source: string | null, tag: string): string {
  const parts = (source ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(",");
}
