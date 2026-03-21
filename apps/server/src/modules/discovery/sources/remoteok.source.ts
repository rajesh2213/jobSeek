import type { DiscoverySourceCompany } from "../discovery.types.js";
import type { CompanySource } from "./source.interface.js";
import { normalizeSourceCompany } from "./source.interface.js";

interface RemoteOkJob {
  company?: string;
  company_url?: string;
}

function getDomainFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

async function fetchRemoteOkSourceCompanies(): Promise<DiscoverySourceCompany[]> {
  const res = await fetch("https://remoteok.com/api", {
    signal: AbortSignal.timeout(7000),
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `RemoteOK source request failed: ${res.status} ${res.statusText}`,
    );
  }

  const payload = (await res.json()) as unknown;
  if (!Array.isArray(payload)) return [];

  const companies: DiscoverySourceCompany[] = [];
  const seen = new Set<string>();
  for (const item of payload as RemoteOkJob[]) {
    const name = item.company?.trim();
    if (!name) continue;
    const domain = getDomainFromUrl(item.company_url);
    const normalized = normalizeSourceCompany({ name, domain });
    const key = normalized.domain
      ? `domain:${normalized.domain}`
      : `name:${normalized.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(normalized);
  }

  return companies;
}

export const remoteokSource: CompanySource = {
  source: "remoteok",
  fetchCompanies: fetchRemoteOkSourceCompanies,
};

