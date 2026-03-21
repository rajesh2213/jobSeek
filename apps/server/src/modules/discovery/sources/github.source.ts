import type { DiscoverySourceCompany } from "../discovery.types.js";
import type { CompanySource } from "./source.interface.js";
import { normalizeSourceCompany } from "./source.interface.js";

function getDomainFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host === "www.github.com") return undefined;
    return host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

async function fetchGithubSourceCompanies(): Promise<DiscoverySourceCompany[]> {
  const endpoint =
    "https://api.github.com/search/users?q=type:org&sort=followers&order=desc&per_page=100";
  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(7000),
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "jobseek-discovery",
      },
    });

    if (res.status === 403 || res.status === 429) {
      return [];
    }
    if (!res.ok) {
      throw new Error(`GitHub source request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      items?: Array<{ login?: string; html_url?: string; blog?: string }>;
    };

    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .map((item) =>
        normalizeSourceCompany({
          name: item.login ?? "",
          domain: getDomainFromUrl(item.blog) ?? getDomainFromUrl(item.html_url),
        }),
      )
      .filter((company) => company.name.length > 0);
  } catch {
    return [];
  }
}

export const githubSource: CompanySource = {
  source: "github",
  fetchCompanies: fetchGithubSourceCompanies,
};
