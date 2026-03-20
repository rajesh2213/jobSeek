import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import type {
  GreenhouseJobListResponse,
  GreenhouseJobSummary,
} from "./greenhouse.types.js";
import { parseGreenhouseJobList } from "./greenhouse.parser.js";

class GreenhouseCrawlerImpl implements AtsCrawler<GreenhouseJobSummary> {
  readonly atsType = "greenhouse" as const;

  async fetchJobs(token: string): Promise<GreenhouseJobSummary[]> {
    await throttleByAts(this.atsType);
    const url = new URL(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    );
    url.searchParams.set("content", "true");

    const data = await fetchJsonWithTimeout<GreenhouseJobListResponse>(
      url.toString(),
      5000,
    );

    if (!data || !Array.isArray(data.jobs)) {
      throw new Error("Unexpected Greenhouse jobs response shape");
    }
    return data.jobs;
  }

  parseJobs(
    rawJobs: GreenhouseJobSummary[],
    companyId: string,
  ) {
    return parseGreenhouseJobList(rawJobs, companyId);
  }
}

export const greenhouseCrawler = new GreenhouseCrawlerImpl();

