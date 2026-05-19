import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const API_BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

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
  const { getToken } = await auth();
  const token = await getToken();

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

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const upstream = new AbortController();
      const upstreamTimeout = setTimeout(() => upstream.abort(), 22_000);
      const res = await fetch(`${API_BASE}/jobs${search}`, {
        headers: upstreamHeaders,
        cache: "no-store",
        signal: upstream.signal,
      });
      clearTimeout(upstreamTimeout);
      const body = await res.text();
      if (isPoolDegraded(res.status, body) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return new NextResponse(body, {
        status: res.status,
        headers: {
          "content-type": res.headers.get("content-type") ?? "application/json",
          "cache-control": "private, no-store",
        },
      });
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  return new NextResponse(degradedJobsBody(page, pageSize), {
    status: 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}
