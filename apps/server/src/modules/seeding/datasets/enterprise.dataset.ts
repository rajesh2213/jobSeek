import type { SeedCompany } from "../seeding.types.js";
import { FORTUNE_500_COMPANIES } from "../../discovery/sources/fortune500.source.js";

export function getEnterpriseDataset(): SeedCompany[] {
  return FORTUNE_500_COMPANIES.map((c) => ({
    name: c.name,
    domain: c.domain,
  }));
}
