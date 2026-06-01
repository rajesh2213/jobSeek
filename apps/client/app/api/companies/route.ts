import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveApiBaseUrl } from "../../../lib/apiBaseUrl";

const API_BASE = resolveApiBaseUrl();

export const dynamic = "force-dynamic";

const DEGRADED_BODY = JSON.stringify({
  data: [],
  meta: {
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1,
    hasMore: false,
    stats: { totalTracked: 0, hiringThisWeek: 0 },
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

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const upstream = new AbortController();
      const upstreamTimeout = setTimeout(() => upstream.abort(), 22_000);
      const res = await fetch(`${API_BASE}/companies${search}`, {
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
          "cache-control": res.headers.get("cache-control") ?? "private, no-store",
        },
      });
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  return new NextResponse(DEGRADED_BODY, {
    status: 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}
