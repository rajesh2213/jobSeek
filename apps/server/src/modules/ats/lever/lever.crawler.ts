import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import type { LeverJob } from "./lever.types.js";
import { parseLeverJobs } from "./lever.parser.js";

class LeverCrawlerImpl implements AtsCrawler<LeverJob> {
  readonly atsType = "lever" as const;

  async fetchJobs(token: string): Promise<LeverJob[]> {
    await throttleByAts(this.atsType);
    const url = new URL(`https://api.lever.co/v0/postings/${token}`);
    url.searchParams.set("mode", "json");

    const data = await fetchJsonWithTimeout<unknown>(url.toString(), 5000);
    if (!Array.isArray(data)) {
      throw new Error("Unexpected Lever jobs response shape");
    }
    return data as LeverJob[];
  }

  parseJobs(rawJobs: LeverJob[], companyId: string) {
    return parseLeverJobs(rawJobs, companyId);
  }
}

export const leverCrawler = new LeverCrawlerImpl();

