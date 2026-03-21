import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import { parseWorkableJobs } from "./workable.parser.js";
import type { WorkableJob, WorkableJobsResponse } from "./workable.types.js";

class WorkableCrawlerImpl implements AtsCrawler<WorkableJob> {
  readonly atsType = "workable" as const;

  async fetchJobs(token: string): Promise<WorkableJob[]> {
    await throttleByAts(this.atsType);
    const url = `https://apply.workable.com/api/v1/widget/accounts/${token}/jobs`;
    const data = await fetchJsonWithTimeout<WorkableJobsResponse>(url, 5000);
    return Array.isArray(data.results) ? data.results : [];
  }

  parseJobs(rawJobs: WorkableJob[], companyId: string) {
    return parseWorkableJobs(rawJobs, companyId);
  }
}

export const workableCrawler = new WorkableCrawlerImpl();

