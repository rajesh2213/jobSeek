import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import { parseSmartRecruitersJobs } from "./smartrecruiters.parser.js";
import type {
  SmartRecruitersJob,
  SmartRecruitersJobsResponse,
} from "./smartrecruiters.types.js";

class SmartRecruitersCrawlerImpl implements AtsCrawler<SmartRecruitersJob> {
  readonly atsType = "smartrecruiters" as const;

  async fetchJobs(token: string): Promise<SmartRecruitersJob[]> {
    await throttleByAts(this.atsType);
    const url = `https://api.smartrecruiters.com/v1/companies/${token}/postings`;
    const data = await fetchJsonWithTimeout<SmartRecruitersJobsResponse>(url, 6000);
    return Array.isArray(data.content) ? data.content : [];
  }

  parseJobs(rawJobs: SmartRecruitersJob[], companyId: string) {
    return parseSmartRecruitersJobs(rawJobs, companyId);
  }
}

export const smartrecruitersCrawler = new SmartRecruitersCrawlerImpl();

