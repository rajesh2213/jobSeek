import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { UserMeResponse } from "../../../../lib/api";

const API_BASE =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * Proxies JobSeek usage from Fastify `GET /account/summary` using the active Clerk session.
 */
export async function GET() {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(`${API_BASE}/account/summary`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const fallback: UserMeResponse = {
        plan: "free",
        jobViewsToday: 0,
        jobViewsLimit: 10,
        resetAt: new Date().toISOString(),
      };
      return NextResponse.json(fallback);
    }
    const data = (await res.json()) as UserMeResponse;
    return NextResponse.json(data);
  } catch {
    const fallback: UserMeResponse = {
      plan: "free",
      jobViewsToday: 0,
      jobViewsLimit: 10,
      resetAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback);
  }
}
