import type { PrismaClient } from "@prisma/client";
import {
  ENRICH_PRIORITY_DEFERRED_RETRY,
  ENRICH_PRIORITY_JOB_DISCOVERED,
} from "../queues/enrich-company.queue.js";

/**
 * Boost deferred enrichment for high-signal companies (recent jobs, ATS hint, domain).
 * BullMQ: lower number = higher priority.
 */
export async function resolveDeferredEnrichmentPriority(
  prisma: PrismaClient,
  companyId: string,
): Promise<number> {
  let p = ENRICH_PRIORITY_DEFERRED_RETRY;

  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      domain: true,
      atsType: true,
      atsBoardToken: true,
    },
  });
  if (!c) return p;

  if (c.atsType?.trim() && c.atsBoardToken?.trim()) {
    p -= 2;
  } else if (c.atsType?.trim()) {
    p -= 1;
  }

  if (c.domain?.trim()) {
    p -= 1;
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [canonicalJobs, recentJobs] = await Promise.all([
    prisma.job.count({
      where: { companyId, canonicalJobId: null },
    }),
    prisma.job.count({
      where: { companyId, lastSeenAt: { gte: weekAgo } },
    }),
  ]);

  if (canonicalJobs >= 3) p -= 1;
  if (recentJobs >= 2) p -= 1;
  else if (recentJobs >= 1) p -= 0;

  return Math.max(ENRICH_PRIORITY_JOB_DISCOVERED, p);
}
