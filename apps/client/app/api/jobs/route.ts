import { auth } from "@clerk/nextjs/server";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveApiBaseUrl } from "../../../lib/apiBaseUrl";
import { hasClerkSessionCookie } from "../../../lib/ssrAuthMode";

const API_BASE = resolveApiBaseUrl();

export const dynamic = "force-dynamic";

const ANON_CACHE_SECONDS = Math.max(
  60,
  Math.min(Number.parseInt(process.env.API_JOBS_ANON_CACHE_SECONDS ?? "90", 10) || 90, 300),
);

function anonJobsResponseCacheEnabled(): boolean {
  return process.env.API_JOBS_ANON_CACHE_ENABLED === "1";
}

function degradedJobsBody(page: number, pageSize: number): string {
  return JSON.stringify({
    data: [],
    meta: {
      page,
      pageSize,
      total: null,
      hasMore: false,
      viewCapUnlimited: false,
    },
    error: "Service temporarily busy",
    code: "DB_POOL_EXHAUSTED",
  });
}

function parsePageLimit(search: string): { page: number; pageSize: number } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "20", 10) || 20));
  return { page, pageSize: limit };
}

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

async function proxyJobsUpstream(
  search: string,
  upstreamHeaders: Headers,
  fetchInit: RequestInit,
): Promise<{ status: number; body: string; contentType: string | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const upstream = new AbortController();
      const upstreamTimeout = setTimeout(() => upstream.abort(), 22_000);
      const res = await fetch(`${API_BASE}/jobs${search}`, {
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
      };
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  return { status: 503, body: "", contentType: "application/json" };
}

/**
 * Browser-facing proxy for `GET /jobs` so anon metering sees the visitor IP chain from Next
 * (`x-forwarded-for` / `x-real-ip`), matching SSR `loadJobsDiscoveryPage`. Direct browser→API
 * calls often arrive at Fastify as loopback-only hops without a trusted forwarded chain.
 */
export async function GET(req: NextRequest) {
  const search = req.nextUrl.search;
  const { page, pageSize } = parsePageLimit(search);
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");

  const hasSession = await hasClerkSessionCookie();
  let token: string | null = null;
  if (hasSession) {
    const { getToken } = await auth();
    token = (await getToken()) ?? null;
  }

  const upstreamHeaders = new Headers();
  const t = token?.trim();
  if (t) upstreamHeaders.set("Authorization", `Bearer ${t}`);
  const xff = forwardedFor?.trim();
  if (xff) upstreamHeaders.set("x-forwarded-for", xff);

  const ua = req.headers.get("user-agent");
  const referer = req.headers.get("referer");
  const origin = req.headers.get("origin");
  if (ua) upstreamHeaders.set("user-agent", ua);
  if (referer) upstreamHeaders.set("referer", referer);
  if (origin) upstreamHeaders.set("origin", origin);

  const isAuthenticated = Boolean(t);

  if (!isAuthenticated && anonJobsResponseCacheEnabled()) {
    const cachedProxy = unstable_cache(
      async () => {
        const headersCopy = new Headers(upstreamHeaders);
        return proxyJobsUpstream(search, headersCopy, {
          next: { revalidate: ANON_CACHE_SECONDS },
        });
      },
      ["api-jobs-anon", search],
      { revalidate: ANON_CACHE_SECONDS },
    );
    const out = await cachedProxy();
    if (out.status === 503 && !out.body) {
      return new NextResponse(degradedJobsBody(page, pageSize), {
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
        "cache-control": `public, s-maxage=${ANON_CACHE_SECONDS}, stale-while-revalidate=${ANON_CACHE_SECONDS * 2}`,
      },
    });
  }

  const out = await proxyJobsUpstream(
    search,
    upstreamHeaders,
    isAuthenticated ? { cache: "no-store" } : { cache: "no-store" },
  );

  if (out.status === 503 && !out.body) {
    return new NextResponse(degradedJobsBody(page, pageSize), {
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
      "cache-control": "private, no-store",
    },
  });
}
