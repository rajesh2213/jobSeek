import type { AtsType } from "../ats/ats.interface.js";
import { CompanyService } from "../company/company.service.js";
import { logger } from "../../utils/logger.js";
import {
  delay,
  getDomainFromUrl,
  normalizeDomain,
  randomIntInclusive,
} from "../../utils/common.js";
import type {
  DiscoverySourceCompany,
  DiscoverySourceType,
} from "./discovery.types.js";
import { ycSource } from "./sources/yc.source.js";
import { githubSource } from "./sources/github.source.js";
import { fortune500Source } from "./sources/fortune500.source.js";
import { weworkremotelySource } from "./sources/weworkremotely.source.js";
import { remoteokSource } from "./sources/remoteok.source.js";
import type { CompanySource } from "./sources/source.interface.js";
import { detectCareersPage } from "./detectors/careers.detector.js";
import { detectAtsType } from "./detectors/ats.detector.js";
import { extractGreenhouseToken } from "./extractors/greenhouse.extractor.js";
import { extractLeverToken } from "./extractors/lever.extractor.js";
import { extractAshbyToken } from "./extractors/ashby.extractor.js";
import { extractWorkdayToken } from "./extractors/workday.extractor.js";

export const discoverySources: CompanySource[] = [
  ycSource,
  githubSource,
  fortune500Source,
  weworkremotelySource,
  remoteokSource,
];

const sourceByName = new Map<DiscoverySourceType, CompanySource>(
  discoverySources.map((source) => [source.source, source]),
);

function extractAtsBoardToken(
  atsType: AtsType,
  html: string | null,
  careersUrl: string | null,
): string | null {
  if (atsType === "greenhouse") return extractGreenhouseToken(html, careersUrl);
  if (atsType === "lever") return extractLeverToken(html, careersUrl);
  if (atsType === "ashby") return extractAshbyToken(html, careersUrl);
  if (atsType === "workday") return extractWorkdayToken(html, careersUrl);
  return null;
}

export class DiscoveryService {
  constructor(private readonly companyService: CompanyService) {}

  async discoverSource(
    source: DiscoverySourceType,
  ): Promise<DiscoverySourceCompany[]> {
    const sourceImpl = sourceByName.get(source);
    if (!sourceImpl) return [];

    logger.info({ event: "source_fetch_start", source }, "Source fetch started");
    try {
      await delay(randomIntInclusive(100, 300));
      const companies = await sourceImpl.fetchCompanies();
      logger.info(
        {
          event: "source_fetch_complete",
          source,
          companies_found: companies.length,
        },
        "Source fetch completed",
      );
      return companies;
    } catch (err) {
      logger.error(
        { event: "source_fetch_failed", source, err },
        "Source fetch failed",
      );
      return [];
    }
  }

  async processCompanyCandidate(
    input: DiscoverySourceCompany,
  ): Promise<"added" | "skipped"> {
    const name = input.name.trim();
    const domain = normalizeDomain(input.domain);

    const byName = await this.companyService.findByName(name);
    if (byName) {
      logger.info({ event: "company_skipped", reason: "name_exists", name, domain }, "Company exists by name");
      return "skipped";
    }

    const existing = await this.companyService.list();
    const domainExists =
      !!domain &&
      existing.some((company) => {
        const existingDomain = getDomainFromUrl(company.careersUrl);
        return existingDomain === domain;
      });

    if (domainExists) {
      logger.info({ event: "company_skipped", reason: "domain_exists", name, domain }, "Company exists by domain");
      return "skipped";
    }

    if (!domain) {
      logger.info(
        { event: "company_skipped", reason: "domain_missing", name },
        "Company skipped because domain is missing",
      );
      return "skipped";
    }

    const careers = await detectCareersPage(domain);
    logger.info(
      {
        event: "careers_detected",
        name,
        domain,
        careersUrl: careers.careersUrl,
      },
      "Careers detection completed",
    );

    if (!careers.careersUrl || !careers.html) {
      return "skipped";
    }

    const byCareersUrl = await this.companyService.findByCareersUrl(
      careers.careersUrl,
    );
    if (byCareersUrl) {
      logger.info(
        {
          event: "company_skipped",
          reason: "careers_url_exists",
          name,
          careersUrl: careers.careersUrl,
        },
        "Company exists by careers url",
      );
      return "skipped";
    }

    const atsType = detectAtsType(careers.html);
    logger.info({ event: "ats_detected", name, domain, atsType }, "ATS detection completed");
    if (!atsType) return "skipped";

    const atsBoardToken = extractAtsBoardToken(atsType, careers.html, careers.careersUrl);
    if (!atsBoardToken) {
      logger.info({ event: "company_skipped", reason: "token_not_found", name, domain, atsType }, "ATS token not found");
      return "skipped";
    }

    await this.companyService.create({
      name,
      careersUrl: careers.careersUrl,
      atsType,
      atsBoardToken,
    });

    logger.info(
      {
        event: "company_added",
        name,
        domain,
        atsType,
        atsBoardToken,
      },
      "Discovered company added",
    );
    return "added";
  }
}
