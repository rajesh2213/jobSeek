import type { DiscoverySourceCompany } from "../discovery.types.js";
import type { CompanySource } from "./source.interface.js";
import { normalizeSourceCompany } from "./source.interface.js";

async function fetchWeWorkRemotelySourceCompanies(): Promise<
  DiscoverySourceCompany[]
> {
  const res = await fetch("https://weworkremotely.com/remote-jobs", {
    signal: AbortSignal.timeout(7000),
    headers: { accept: "text/html" },
  });

  if (!res.ok) {
    throw new Error(
      `WeWorkRemotely source request failed: ${res.status} ${res.statusText}`,
    );
  }

  const html = await res.text();
  const matches = [
    ...html.matchAll(/class=["']company(?:\s[^"']*)?["'][^>]*>([^<]+)</gi),
  ];
  const seen = new Set<string>();
  const companies: DiscoverySourceCompany[] = [];

  for (const match of matches) {
    const rawName = match[1]?.trim();
    if (!rawName) continue;
    const normalizedName = rawName.replace(/\s+/g, " ");
    const key = normalizedName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(
      normalizeSourceCompany({
        name: normalizedName,
        domain: undefined,
      }),
    );
  }

  return companies;
}

export const weworkremotelySource: CompanySource = {
  source: "weworkremotely",
  fetchCompanies: fetchWeWorkRemotelySourceCompanies,
};

