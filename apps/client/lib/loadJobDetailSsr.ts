import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { fetchJobById } from "./api";

function logJobDedupe(payload: Record<string, unknown>): void {
  if (process.env.DEBUG_SSR_DEDUPE !== "1") return;
  console.info(JSON.stringify(payload));
}

/**
 * Dedupes duplicate metadata + page work inside one SSR/RSC tree (`React.cache` is per-request,
 * not cross-request — does not reduce traffic volume across navigations).
 */
export const loadJobDetailCached = cache(async (id: string) => {
  const { getToken } = await auth();
  const token = await getToken();
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  const result = await fetchJobById(id, { token, forwardedFor });
  logJobDedupe({
    event: "job_detail_dedupe_check",
    phase: "fetch_completed",
    jobId: id,
  });
  return result;
});

export async function resolveJobDetail(id: string, calledFrom: "metadata" | "page") {
  logJobDedupe({
    event: "job_detail_dedupe_check",
    calledFrom,
  });
  return loadJobDetailCached(id);
}
