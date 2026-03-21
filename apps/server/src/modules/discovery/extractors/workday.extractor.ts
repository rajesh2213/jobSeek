interface WorkdayToken {
  host: string;
  tenant: string;
  site: string;
}

function parseWorkdayUrl(value: string): WorkdayToken | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!host.includes("myworkdayjobs.com")) return null;
    const tenant = host.split(".")[0];
    const pathParts = url.pathname.split("/").filter(Boolean);
    const site = pathParts[pathParts.length - 1];
    if (!tenant || !site) return null;
    return { host, tenant, site };
  } catch {
    return null;
  }
}

export function extractWorkdayToken(
  html: string | null,
  careersUrl: string | null,
): string | null {
  const candidates: string[] = [];
  if (careersUrl) candidates.push(careersUrl);
  if (html) {
    for (const match of html.matchAll(/https?:\/\/[^\s"'<>]*myworkdayjobs\.com[^\s"'<>]*/gi)) {
      candidates.push(match[0]);
    }
  }

  for (const candidate of candidates) {
    const parsed = parseWorkdayUrl(candidate);
    if (parsed) return JSON.stringify(parsed);
  }
  return null;
}

