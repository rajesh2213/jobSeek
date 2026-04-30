import "./scriptEnv.js";

/**
 * Reset daily job discovery view quotas for local/testing:
 * - All rows in User: jobViewsToday -> 0, jobViewsResetAt -> now()
 * - Redis keys matching viewcap:anon:* (anonymous IP caps)
 *
 * Does NOT flush Redis entirely (other queues/cache untouched).
 */
import { Redis } from "ioredis";
import { prisma } from "../src/infrastructure/db/prisma.js";

const ANON_VIEWCAP_PREFIX = "viewcap:anon:";

function redisEndpointMasked(urlStr: string): string {
  try {
    const normalized = urlStr.includes("://") ? urlStr : `redis://${urlStr}`;
    const u = new URL(normalized);
    const db = (u.pathname || "/").replace("/", "") || "0";
    let auth = "";
    if (u.password) auth = `${u.username || "default"}:****@`;
    else if (u.username) auth = `${u.username}@`;
    const port = u.port || "6379";
    return `${auth}${u.hostname}:${port} db=${db}`;
  } catch {
    return "(could not parse REDIS_URL)";
  }
}

/**
 * Anonymous daily caps live under `viewcap:anon:*` (hashed IP). Use KEYS here — keyspace
 * for this prefix stays tiny (distinct IPs hitting /jobs today), and KEYS is more reliable
 * than SCAN across Redis/ioredis versions for admin reset scripts.
 */
async function deleteAnonViewCapKeys(redis: Redis): Promise<{ found: number; deleted: number }> {
  const keys = await redis.keys(`${ANON_VIEWCAP_PREFIX}*`);
  if (keys.length === 0) return { found: 0, deleted: 0 };
  const chunk = 500;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    deleted += await redis.del(...slice);
  }
  return { found: keys.length, deleted };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RESET !== "true") {
    throw new Error(
      "Refusing quota reset in production. Set ALLOW_PROD_RESET=true to override.",
    );
  }

  const users = await prisma.user.updateMany({
    data: {
      jobViewsToday: 0,
      jobViewsResetAt: new Date(),
    },
  });

  let redisFound = 0;
  let redisDeleted = 0;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    console.log("[reset:job-view-quota] REDIS_URL →", redisEndpointMasked(redisUrl));
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    try {
      const out = await deleteAnonViewCapKeys(redis);
      redisFound = out.found;
      redisDeleted = out.deleted;
    } finally {
      redis.disconnect();
    }
  } else {
    console.warn(
      "[reset:job-view-quota] REDIS_URL missing — skipped anon Redis keys (logged-out /jobs quota unchanged)",
    );
  }

  console.log(
    JSON.stringify(
      {
        event: "job_view_quota_reset",
        usersUpdated: users.count,
        redisAnonKeysFound: redisFound,
        redisAnonKeysDeleted: redisDeleted,
        note:
          redisUrl && redisFound === 0
            ? "No viewcap:anon:* keys in this Redis. If quota still looks capped while logged out, confirm API server uses the same REDIS_URL."
            : undefined,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((err) => {
    console.error("[reset:job-view-quota] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {
      /* ignore */
    });
  });
