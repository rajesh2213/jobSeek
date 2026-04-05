import { CompanyService } from "../company/company.service.js";
import { logger } from "../../utils/logger.js";
import { normalizeDomain } from "../../utils/common.js";
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

export class DiscoveryService {
  constructor(private readonly companyService: CompanyService) {}

  async discoverSource(
    source: DiscoverySourceType,
  ): Promise<DiscoverySourceCompany[]> {
    const sourceImpl = sourceByName.get(source);
    if (!sourceImpl) return [];

    logger.info({ event: "source_fetch_start", source }, "Source fetch started");
    try {
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

  /**
   * Add a discovery candidate as a raw company and enqueue enrichment (domain optional).
   */
  async processCompanyCandidate(
    input: DiscoverySourceCompany & { source: DiscoverySourceType },
  ): Promise<"added" | "skipped"> {
    const name = input.name.trim();
    if (!name) {
      return "skipped";
    }

    const existing = await this.companyService.findByName(name);
    if (existing) {
      logger.info(
        { event: "company_skipped", reason: "name_exists", name },
        "Company exists by name",
      );
      return "skipped";
    }

    const domainNorm = normalizeDomain(input.domain);
    await this.companyService.createRawFromDiscovery({
      name,
      domain: domainNorm ?? null,
      discoverySource: input.source,
    });

    logger.info(
      {
        event: "company_added",
        name,
        domain: domainNorm ?? null,
        source: input.source,
        flow: "raw_then_enrich",
      },
      "Discovered company queued for enrichment",
    );
    return "added";
  }
}
