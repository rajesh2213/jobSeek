import {
  DEFAULT_SERP_FETCH_RETRY,
  fetchWithRetry,
} from "../../utils/fetchWithRetry.js";

export type SerpApiResult = {
  url: string;
  title?: string;
  snippet?: string;
  rank?: number;
};

const SPAM_HOST_SUFFIXES = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "wikipedia.org",
];

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();

    u.search = "";

    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    const segs = path.split("/").filter(Boolean);
    if (
      segs.length > 1 &&
      ["jobs", "careers"].includes(segs[1].toLowerCase())
    ) {
      path = `/${segs[0]}`;
    }

    u.pathname = path;

    u.hash = "";
    u.username = "";
    u.password = "";

    return u.toString();
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedSerpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!u.protocol.startsWith("http")) return false;
    if (SPAM_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s))) return false;
    return true;
  } catch {
    return false;
  }
}

function uniqByUrl(results: SerpApiResult[]): SerpApiResult[] {
  const seen = new Set<string>();
  const out: SerpApiResult[] = [];
  for (const r of results) {
    const nu = normalizeUrl(r.url);
    if (!nu) continue;
    if (seen.has(nu)) continue;
    if (!isAllowedSerpUrl(nu)) continue;
    seen.add(nu);
    out.push({ ...r, url: nu });
  }
  return out;
}

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

async function fetchSerpApi(query: string): Promise<SerpApiResult[]> {
  const apiKey = getEnv("SERPAPI_KEY") ?? getEnv("SERPAPI_API_KEY");
  if (!apiKey) throw new Error("Missing SERPAPI_KEY env var");

  const url =
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}` +
    `&api_key=${encodeURIComponent(apiKey)}&num=10`;
  const res = await fetchWithRetry(url, undefined, DEFAULT_SERP_FETCH_RETRY);
  if (!res.ok) throw new Error(`SERPAPI request failed (${res.status} ${res.statusText})`);
  const data = (await res.json()) as unknown as {
    organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
  };
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  return organic
    .map((r, idx) => ({
      url: r.link ?? "",
      title: r.title,
      snippet: r.snippet,
      rank: idx + 1,
    }))
    .filter((r) => r.url.trim().length > 0);
}

async function fetchGoogleCse(query: string): Promise<SerpApiResult[]> {
  const apiKey = getEnv("GOOGLE_API_KEY");
  const cx = getEnv("GOOGLE_CSE_ID") ?? getEnv("GOOGLE_CX");
  if (!apiKey || !cx) throw new Error("Missing GOOGLE_API_KEY and/or GOOGLE_CSE_ID env vars");

  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=10`;

  const res = await fetchWithRetry(url, undefined, DEFAULT_SERP_FETCH_RETRY);
  if (!res.ok) throw new Error(`Google CSE request failed (${res.status} ${res.statusText})`);

  const data = (await res.json()) as unknown as {
    items?: Array<{ link?: string; title?: string; snippet?: string }>;
  };
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((r, idx) => ({
      url: r.link ?? "",
      title: r.title,
      snippet: r.snippet,
      rank: idx + 1,
    }))
    .filter((r) => r.url.trim().length > 0);
}

const MAX_RESULTS_PER_QUERY = 10;

export async function fetchSerpResults(query: string): Promise<SerpApiResult[]> {
  const serpApiKey = getEnv("SERPAPI_KEY") ?? getEnv("SERPAPI_API_KEY");
  const googleKey = getEnv("GOOGLE_API_KEY");

  const raw =
    serpApiKey ? await fetchSerpApi(query) : googleKey ? await fetchGoogleCse(query) : null;

  if (!raw) {
    throw new Error("No SERP provider configured. Set SERPAPI_KEY or GOOGLE_API_KEY + GOOGLE_CSE_ID.");
  }

  const capped = raw.slice(0, MAX_RESULTS_PER_QUERY);

  const normalized = capped
    .map((r) => ({ ...r, url: normalizeUrl(r.url) ?? r.url }))
    .filter((r) => r.url?.trim().startsWith("http"));

  return uniqByUrl(normalized);
}

