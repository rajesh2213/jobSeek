import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import {
  closeIngestAtsEndpointQueue,
  getIngestAtsEndpointQueue,
  INGEST_ATS_ENDPOINT_JOB,
} from "../queues/ats-endpoint.queue.js";

const INVALID_SIGNATURE = "page not found. the url you have provided is invalid";
const WORKDAY_ROOT_SNIPPET = "myworkdayjobs.com/job/";
const DETAIL_TIMEOUT_MS = 12000;

type Args = {
  apply: boolean;
  companyBatch: number;
  maxEnqueue: number;
  minSuspiciousPerCompany: number;
  sampleRows: number;
  endpointCooldownMinutes: number;
  maxQueueDepth: number;
};

type SuspiciousCompanyRow = {
  companyId: string;
  companyName: string;
  suspiciousCount: bigint;
};

type UrlSampleRow = {
  id: string;
  sourceUrl: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apply: false,
    companyBatch: 100,
    maxEnqueue: 40,
    minSuspiciousPerCompany: 2,
    sampleRows: 20,
    endpointCooldownMinutes: 90,
    maxQueueDepth: 120,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    if (arg === "--company-batch") out.companyBatch = Number(argv[i + 1] ?? out.companyBatch);
    if (arg === "--max-enqueue") out.maxEnqueue = Number(argv[i + 1] ?? out.maxEnqueue);
    if (arg === "--min-suspicious") {
      out.minSuspiciousPerCompany = Number(argv[i + 1] ?? out.minSuspiciousPerCompany);
    }
    if (arg === "--sample-rows") out.sampleRows = Number(argv[i + 1] ?? out.sampleRows);
    if (arg === "--endpoint-cooldown-minutes") {
      out.endpointCooldownMinutes = Number(argv[i + 1] ?? out.endpointCooldownMinutes);
    }
    if (arg === "--max-queue-depth") out.maxQueueDepth = Number(argv[i + 1] ?? out.maxQueueDepth);
  }
  out.companyBatch = Math.max(10, Math.min(2000, Math.floor(out.companyBatch)));
  out.maxEnqueue = Math.max(1, Math.min(500, Math.floor(out.maxEnqueue)));
  out.minSuspiciousPerCompany = Math.max(1, Math.min(500, Math.floor(out.minSuspiciousPerCompany)));
  out.sampleRows = Math.max(0, Math.min(200, Math.floor(out.sampleRows)));
  out.endpointCooldownMinutes = Math.max(5, Math.min(1440, Math.floor(out.endpointCooldownMinutes)));
  out.maxQueueDepth = Math.max(1, Math.min(5000, Math.floor(out.maxQueueDepth)));
  return out;
}

function toNum(value: bigint): number {
  return Number(value);
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

async function detectInvalidWorkdayPage(url: string): Promise<"valid" | "invalid_signature" | "unreachable"> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS) });
    if (!res.ok) return "unreachable";
    const body = normalizeText(await res.text());
    if (body.includes(INVALID_SIGNATURE)) return "invalid_signature";
    return "valid";
  } catch {
    return "unreachable";
  }
}

async function suspiciousRowsByCompany(limit: number, minSuspicious: number): Promise<SuspiciousCompanyRow[]> {
  return prisma.$queryRaw<SuspiciousCompanyRow[]>`
    SELECT
      j."companyId" AS "companyId",
      c.name AS "companyName",
      COUNT(*)::bigint AS "suspiciousCount"
    FROM "Job" j
    JOIN "Company" c ON c.id = j."companyId"
    WHERE j.source = 'workday'
      AND j."canonicalJobId" IS NULL
      AND (
        LOWER(j."sourceUrl") LIKE ${`%${WORKDAY_ROOT_SNIPPET}%`}
        OR j.description IS NULL
        OR BTRIM(j.description) = ''
        OR (
          j."parsedDescription" IS NOT NULL
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'position'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'responsibility'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'requirement'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'experience'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'benefit'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'contact'), 0) = 0
          AND COALESCE(jsonb_array_length(j."parsedDescription"->'other'), 0) = 0
        )
      )
    GROUP BY j."companyId", c.name
    HAVING COUNT(*) >= ${minSuspicious}
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `;
}

async function sampleRootPathUrls(limit: number): Promise<UrlSampleRow[]> {
  if (limit <= 0) return [];
  return prisma.$queryRaw<UrlSampleRow[]>`
    SELECT j.id, j."sourceUrl"
    FROM "Job" j
    WHERE j.source = 'workday'
      AND j."canonicalJobId" IS NULL
      AND LOWER(j."sourceUrl") LIKE ${`%${WORKDAY_ROOT_SNIPPET}%`}
    ORDER BY j."createdAt" DESC
    LIMIT ${limit}
  `;
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const queue = getIngestAtsEndpointQueue();
  const nowMs = Date.now();
  const cooldownMs = args.endpointCooldownMinutes * 60_000;

  const suspiciousCompanies = await suspiciousRowsByCompany(
    args.companyBatch,
    args.minSuspiciousPerCompany,
  );
  const companyIds = suspiciousCompanies.map((r) => r.companyId);

  const endpoints = companyIds.length
    ? await prisma.atsEndpoint.findMany({
        where: {
          companyId: { in: companyIds },
          type: "workday",
        },
        select: {
          id: true,
          companyId: true,
          slug: true,
          baseUrl: true,
          lastCrawledAt: true,
          lastFailureAt: true,
          failureCount: true,
        },
        orderBy: [{ lastCrawledAt: "asc" }, { id: "asc" }],
      })
    : [];

  const endpointByCompany = new Map<string, (typeof endpoints)[number]>();
  for (const ep of endpoints) {
    if (!ep.companyId) continue;
    if (!endpointByCompany.has(ep.companyId)) endpointByCompany.set(ep.companyId, ep);
  }

  const waitingBefore = await queue.getWaitingCount();
  const activeBefore = await queue.getActiveCount();
  const delayedBefore = await queue.getDelayedCount();
  const queueDepthBefore = waitingBefore + activeBefore + delayedBefore;
  const queueBackpressured = queueDepthBefore >= args.maxQueueDepth;

  const selectedRaw = suspiciousCompanies
    .map((row) => ({ row, endpoint: endpointByCompany.get(row.companyId) ?? null }))
    .filter((x) => x.endpoint !== null);

  const cooldownSkipped: Array<{ endpointId: string; companyId: string; reason: string }> = [];
  const selected = selectedRaw
    .filter((entry) => {
      const endpoint = entry.endpoint!;
      const lastCrawledMs = endpoint.lastCrawledAt ? endpoint.lastCrawledAt.getTime() : 0;
      if (lastCrawledMs > 0 && nowMs - lastCrawledMs < cooldownMs) {
        cooldownSkipped.push({
          endpointId: endpoint.id,
          companyId: endpoint.companyId ?? "unknown",
          reason: "recent_crawl",
        });
        return false;
      }
      const lastFailureMs = endpoint.lastFailureAt ? endpoint.lastFailureAt.getTime() : 0;
      if (endpoint.failureCount >= 4 && lastFailureMs > 0 && nowMs - lastFailureMs < cooldownMs) {
        cooldownSkipped.push({
          endpointId: endpoint.id,
          companyId: endpoint.companyId ?? "unknown",
          reason: "recent_failure_high_failure_count",
        });
        return false;
      }
      return true;
    })
    .slice(0, args.maxEnqueue);

  let enqueued = 0;
  const queueDuplicateSkipped: string[] = [];
  if (args.apply && !queueBackpressured) {
    for (const entry of selected) {
      const endpoint = entry.endpoint!;
      const jobId = `workday-repair-${endpoint.id}`;
      const existing = await queue.getJob(jobId);
      if (existing) {
        queueDuplicateSkipped.push(endpoint.id);
        continue;
      }
      await queue.add(
        INGEST_ATS_ENDPOINT_JOB,
        { endpointId: endpoint.id },
        {
          jobId,
          removeOnComplete: true,
          attempts: 2,
          backoff: { type: "exponential", delay: 15000 },
        },
      );
      enqueued += 1;
    }
  }

  const samples = await sampleRootPathUrls(args.sampleRows);
  let sampleValid = 0;
  let sampleInvalid = 0;
  let sampleUnreachable = 0;
  for (const sample of samples) {
    const verdict = await detectInvalidWorkdayPage(sample.sourceUrl);
    if (verdict === "valid") sampleValid += 1;
    if (verdict === "invalid_signature") sampleInvalid += 1;
    if (verdict === "unreachable") sampleUnreachable += 1;
  }

  const waiting = await queue.getWaitingCount();
  const active = await queue.getActiveCount();
  const delayed = await queue.getDelayedCount();

  const report = {
    mode: args.apply ? "apply" : "dry_run",
    suspiciousCompanies: suspiciousCompanies.length,
    companiesWithWorkdayEndpoint: selectedRaw.length,
    eligibleAfterCooldown: selected.length,
    maxEnqueue: args.maxEnqueue,
    enqueued,
    queueBackpressured,
    queueDepthBefore: {
      waiting: waitingBefore,
      active: activeBefore,
      delayed: delayedBefore,
      total: queueDepthBefore,
      maxAllowed: args.maxQueueDepth,
    },
    queueDepth: { waiting, active, delayed, total: waiting + active + delayed },
    skipped: {
      cooldown: cooldownSkipped.length,
      duplicates: queueDuplicateSkipped.length,
    },
    suspiciousTop10: suspiciousCompanies.slice(0, 10).map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName,
      suspiciousCount: toNum(r.suspiciousCount),
    })),
    cooldownSkippedSample: cooldownSkipped.slice(0, 10),
    duplicateSkippedSample: queueDuplicateSkipped.slice(0, 10),
    sampleRootPathValidation: {
      sampled: samples.length,
      valid: sampleValid,
      invalidSignature: sampleInvalid,
      unreachable: sampleUnreachable,
    },
    nextStep:
      "Run with --apply during low traffic windows; keep max-enqueue low and re-run iteratively.",
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeIngestAtsEndpointQueue();
    await prisma.$disconnect();
  });
