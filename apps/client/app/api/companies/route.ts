import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveApiBaseUrl } from "../../../lib/apiBaseUrl";

const API_BASE = resolveApiBaseUrl();

export const dynamic = "force-dynamic";

const ANON_CACHE_SECONDS = Math.max(
  60,
  Math.min(
    Number.parseInt(process.env.API_COMPANIES_ANON_CACHE_SECONDS ?? "120", 10) || 120,
    300,
  ),
);

function anonCompaniesResponseCacheEnabled(): boolean {
  return (process.env.API_COMPANIES_ANON_CACHE_ENABLED ?? "1").trim() !== "0";
}

const DEGRADED_BODY = JSON.stringify({
  data: [],
  meta: {
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1,
    hasMore: false,
    stats: { totalTracked: 0, hiringThisWeek: 0, activeHiringCompanies: 0 },
  },
  error: "Service temporarily busy",
  code: "DB_POOL_EXHAUSTED",
});

function isPoolDegraded(status: number, body: string): boolean {
  if (status === 503) return true;
  if (status !== 500) return false;
  try {
    const parsed = JSON.parse(body) as { code?: string };
    return parsed.code === "P2024" || parsed.code === "DB_POOL_EXHAUSTED";
  } catch {
    return body.includes("P2024");
  }
}

async function proxyCompaniesUpstream(
  search: string,
  upstreamHeaders: Headers,
  fetchInit: RequestInit,
): Promise<{ status: number; body: string; contentType: string | null; cacheControl: string | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const upstream = new AbortController();
      const upstreamTimeout = setTimeout(() => upstream.abort(), 22_000);
      const res = await fetch(`${API_BASE}/companies${search}`, {
        ...fetchInit,
        headers: upstreamHeaders,
        signal: upstream.signal,
      });
      clearTimeout(upstreamTimeout);
      const body = await res.text();
      if (isPoolDegraded(res.status, body) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return {
        status: res.status,
        body,
        contentType: res.headers.get("content-type"),
        cacheControl: res.headers.get("cache-control"),
      };
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  return { status: 503, body: "", contentType: "application/json", cacheControl: null };
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search;
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");

  const upstreamHeaders = new Headers();
  const xff = forwardedFor?.trim();
  if (xff) upstreamHeaders.set("x-forwarded-for", xff);

  const ua = req.headers.get("user-agent");
  const referer = req.headers.get("referer");
  const origin = req.headers.get("origin");
  if (ua) upstreamHeaders.set("user-agent", ua);
  if (referer) upstreamHeaders.set("referer", referer);
  if (origin) upstreamHeaders.set("origin", origin);

  if (anonCompaniesResponseCacheEnabled()) {
    const cachedProxy = unstable_cache(
      async () => {
        const headersCopy = new Headers(upstreamHeaders);
        return proxyCompaniesUpstream(search, headersCopy, {
          next: { revalidate: ANON_CACHE_SECONDS },
        });
      },
      ["api-companies-anon", search],
      { revalidate: ANON_CACHE_SECONDS },
    );
    const out = await cachedProxy();
    if (out.status === 503 && !out.body) {
      return new NextResponse(DEGRADED_BODY, {
        status: 503,
        headers: {
          "content-type": "application/json",
          "cache-control": "private, no-store",
        },
      });
    }
    return new NextResponse(out.body, {
      status: out.status,
      headers: {
        "content-type": out.contentType ?? "application/json",
        "cache-control":
          out.cacheControl ??
          `public, s-maxage=${ANON_CACHE_SECONDS}, stale-while-revalidate=${ANON_CACHE_SECONDS * 2}`,
      },
    });
  }

  const out = await proxyCompaniesUpstream(search, upstreamHeaders, { cache: "no-store" });
  if (out.status === 503 && !out.body) {
    return new NextResponse(DEGRADED_BODY, {
      status: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
    });
  }

  return new NextResponse(out.body, {
    status: out.status,
    headers: {
      "content-type": out.contentType ?? "application/json",
      "cache-control": out.cacheControl ?? "private, no-store",
    },
  });
}
