import type { AtsCrawler } from "../ats.interface.js";
import { fetchJsonWithTimeout, throttleByAts } from "../ats.interface.js";
import { parseSmartRecruitersJobs } from "./smartrecruiters.parser.js";
import type {
  SmartRecruitersJob,
  SmartRecruitersJobsResponse,
} from "./smartrecruiters.types.js";
import { asyncPool } from "../../../utils/asyncPool.js";

class SmartRecruitersCrawlerImpl implements AtsCrawler<SmartRecruitersJob> {
  readonly atsType = "smartrecruiters" as const;

  async fetchJobs(token: string): Promise<SmartRecruitersJob[]> {
    await throttleByAts(this.atsType);

    const limit = 50;
    let offset = 0;
    const maxPages = 6;
    const all: SmartRecruitersJob[] = [];

    for (let page = 0; page < maxPages; page++) {
      const url = `https://api.smartrecruiters.com/v1/companies/${token}/postings?offset=${offset}&limit=${limit}`;
      const data = await fetchJsonWithTimeout<SmartRecruitersJobsResponse>(url, 6000);
      const content = Array.isArray(data.content) ? data.content : [];
      if (content.length === 0) break;

      for (const j of content) {
        all.push({ ...j, companyToken: token });
      }

      offset += content.length;
      if (typeof data.totalFound === "number" && offset >= data.totalFound) break;
    }

    const needsDetail = all.filter((j) => !j.description || j.description.trim().length < 120);
    const toDetail = needsDetail.slice(0, 15);
    if (toDetail.length > 0) {
      const enriched = await asyncPool(toDetail, 3, async (j) => {
        if (!j.ref) return j;
        try {
          const ref = j.ref.trim();
          const detailUrl = ref.startsWith("http")
            ? ref
            : `https://api.smartrecruiters.com${ref}`;
          const detail = await fetchJsonWithTimeout<Record<string, unknown>>(detailUrl, 6000);

          const desc =
            (typeof detail.description === "string" && detail.description) ||
            (typeof detail.jobDescription === "string" && detail.jobDescription) ||
            (typeof (detail as any).body === "string" && (detail as any).body) ||
            (typeof (detail as any).html === "string" && (detail as any).html);

          const releasedDate =
            (typeof detail.releasedDate === "string" && detail.releasedDate) ||
            (typeof (detail as any).datePosted === "string" && (detail as any).datePosted) ||
            (typeof (detail as any).postedAt === "string" && (detail as any).postedAt);

          return {
            ...j,
            description: typeof desc === "string" ? desc : j.description,
            releasedDate: typeof releasedDate === "string" ? releasedDate : j.releasedDate,
          };
        } catch {
          return j;
        }
      });

      const byId = new Map<string, SmartRecruitersJob>();
      for (const j of enriched) {
        if (j.id) byId.set(j.id, j);
      }

      return all.map((j) => {
        const key = j.id ?? "";
        return key && byId.has(key) ? (byId.get(key) as SmartRecruitersJob) : j;
      });
    }

    return all;
  }

  parseJobs(rawJobs: SmartRecruitersJob[], companyId: string) {
    return parseSmartRecruitersJobs(rawJobs, companyId);
  }
}

export const smartrecruitersCrawler = new SmartRecruitersCrawlerImpl();

