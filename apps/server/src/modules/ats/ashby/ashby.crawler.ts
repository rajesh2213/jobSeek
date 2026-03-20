import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import type { AshbyJob, AshbyJobBoardResponse } from "./ashby.types.js";
import { parseAshbyJobs } from "./ashby.parser.js";

class AshbyCrawlerImpl implements AtsCrawler<AshbyJob> {
  readonly atsType = "ashby" as const;

  async fetchJobs(token: string): Promise<AshbyJob[]> {
    await throttleByAts(this.atsType);
    const url = `https://api.ashbyhq.com/posting-api/job-board/${token}`;
    const data = await fetchJsonWithTimeout<AshbyJobBoardResponse>(
      url,
      5000,
    );
    return Array.isArray(data.jobs) ? data.jobs : [];
  }

  parseJobs(rawJobs: AshbyJob[], companyId: string) {
    return parseAshbyJobs(rawJobs, companyId);
  }
}

export const ashbyCrawler = new AshbyCrawlerImpl();

