import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const API_BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

/**
 * Browser-facing proxy for `GET /jobs` so anon metering sees the visitor IP chain from Next
 * (`x-forwarded-for` / `x-real-ip`), matching SSR `loadJobsDiscoveryPage`. Direct browser→API
 * calls often arrive at Fastify as loopback-only hops without a trusted forwarded chain.
 */
export async function GET(req: NextRequest) {
  const search = req.nextUrl.search;
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

  try {
    const res = await fetch(`${API_BASE}/jobs${search}`, {
      headers: upstreamHeaders,
      cache: "no-store",
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
