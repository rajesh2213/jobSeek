import type { AtsCrawler } from "./ats.interface.js";
import { ashbyCrawler } from "./ashby/ashby.crawler.js";
import { bamboohrCrawler } from "./bamboohr/bamboohr.crawler.js";
import { greenhouseCrawler } from "./greenhouse/greenhouse.crawler.js";
import { leverCrawler } from "./lever/lever.crawler.js";
import { ripplingCrawler } from "./rippling/rippling.crawler.js";
import { smartrecruitersCrawler } from "./smartrecruiters/smartrecruiters.crawler.js";
import { teamtailorCrawler } from "./teamtailor/teamtailor.crawler.js";
import { workableCrawler } from "./workable/workable.crawler.js";
import { workdayCrawler } from "./workday/workday.crawler.js";
import { jobviteCrawler } from "./jobvite/jobvite.crawler.js";

export function getAtsCrawler(atsType: string): AtsCrawler<unknown> {
  switch (atsType) {
    case "greenhouse":
      return greenhouseCrawler as AtsCrawler<unknown>;
    case "lever":
      return leverCrawler as AtsCrawler<unknown>;
    case "ashby":
      return ashbyCrawler as AtsCrawler<unknown>;
    case "workable":
      return workableCrawler as AtsCrawler<unknown>;
    case "smartrecruiters":
      return smartrecruitersCrawler as AtsCrawler<unknown>;
    case "bamboohr":
      return bamboohrCrawler as AtsCrawler<unknown>;
    case "teamtailor":
      return teamtailorCrawler as AtsCrawler<unknown>;
    case "rippling":
      return ripplingCrawler as AtsCrawler<unknown>;
    case "jobvite":
      return jobviteCrawler as AtsCrawler<unknown>;
    case "workday":
      return workdayCrawler as AtsCrawler<unknown>;
    default:
      throw new Error(`Unsupported ATS type: ${atsType}`);
  }
}

