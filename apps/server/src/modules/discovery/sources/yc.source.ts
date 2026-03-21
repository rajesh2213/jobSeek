import type { DiscoverySourceCompany } from "../discovery.types.js";
import type { CompanySource } from "./source.interface.js";
import { normalizeSourceCompany } from "./source.interface.js";

function normalizeDomain(input: string): string | null {
  try {
    const withProtocol = input.startsWith("http") ? input : `https://${input}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchYcSourceCompanies(): Promise<DiscoverySourceCompany[]> {
  const res = await fetch("https://www.ycombinator.com/companies", {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "text/html" },
  });

  if (!res.ok) {
    throw new Error(`YC source request failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const matches = [...html.matchAll(/"name":"([^\"]+)"[^}]*?"website":"(https?:\\\/\\\/[^\"]+)"/g)];

  const companies: DiscoverySourceCompany[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const name = m[1]?.trim();
    const websiteRaw = m[2]?.replaceAll("\\/", "/");
    if (!name || !websiteRaw) continue;
    const domain = normalizeDomain(websiteRaw);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    companies.push(normalizeSourceCompany({ name, domain }));
  }

  return companies;
}

export const ycSource: CompanySource = {
  source: "yc",
  fetchCompanies: fetchYcSourceCompanies,
};
