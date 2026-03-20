import type { AtsCrawler } from "./ats.interface.js";
import { ashbyCrawler } from "./ashby/ashby.crawler.js";
import { greenhouseCrawler } from "./greenhouse/greenhouse.crawler.js";
import { leverCrawler } from "./lever/lever.crawler.js";

export function getAtsCrawler(atsType: string): AtsCrawler<unknown> {
  switch (atsType) {
    case "greenhouse":
      return greenhouseCrawler as AtsCrawler<unknown>;
    case "lever":
      return leverCrawler as AtsCrawler<unknown>;
    case "ashby":
      return ashbyCrawler as AtsCrawler<unknown>;
    default:
      throw new Error(`Unsupported ATS type: ${atsType}`);
  }
}

