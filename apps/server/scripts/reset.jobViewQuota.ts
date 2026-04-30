import "./scriptEnv.js";

/**
 * Reset daily job discovery view quotas for local/testing:
 * - All rows in User: jobViewsToday -> 0, jobViewsResetAt -> now()
 * - Redis keys matching viewcap:anon:* (anonymous IP caps)
 *
 * Does NOT flush Redis entirely (other queues/cache untouched).
 *
 * Flags:
 *   --anon-redis-only   Skip DB User updates; only touch Redis anon keys.
 *   --ip <address>      Delete only this IP's anon cap key (implies Redis work only for that key).
 */
import { Redis } from "ioredis";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { viewCapAnonRedisKey } from "../src/modules/viewCap/viewCap.service.js";

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

async function deleteAnonViewCapForIp(
  redis: Redis,
  ip: string,
): Promise<{ found: number; deleted: number; key: string }> {
  const key = viewCapAnonRedisKey(ip.trim());
  const existed = await redis.exists(key);
  const deleted = await redis.del(key);
  return { found: existed ? 1 : 0, deleted, key };
}

function parseArgs(argv: string[]): { anonRedisOnly: boolean; ip: string | null } {
  let anonRedisOnly = false;
  let ip: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--anon-redis-only") {
      anonRedisOnly = true;
      continue;
    }
    if (a === "--ip") {
      const next = argv[i + 1]?.trim();
      if (!next) throw new Error("--ip requires an address");
      ip = next;
      i += 1;
      continue;
    }
    if (a.startsWith("--ip=")) {
      const rest = a.slice("--ip=".length).trim();
      if (!rest) throw new Error("--ip= requires an address");
      ip = rest;
    }
  }
  if (ip) anonRedisOnly = true;
  return { anonRedisOnly, ip };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RESET !== "true") {
    throw new Error(
      "Refusing quota reset in production. Set ALLOW_PROD_RESET=true to override.",
    );
  }

  const { anonRedisOnly, ip: resetIp } = parseArgs(process.argv.slice(2));

  let usersUpdated = 0;
  if (!anonRedisOnly) {
    const users = await prisma.user.updateMany({
      data: {
        jobViewsToday: 0,
        jobViewsResetAt: new Date(),
      },
    });
    usersUpdated = users.count;
  } else {
    console.log("[reset:job-view-quota] --anon-redis-only: skipping User table updates");
  }

  let redisFound = 0;
  let redisDeleted = 0;
  let singleKey: string | undefined;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    console.log("[reset:job-view-quota] REDIS_URL →", redisEndpointMasked(redisUrl));
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    try {
      if (resetIp) {
        const out = await deleteAnonViewCapForIp(redis, resetIp);
        redisFound = out.found;
        redisDeleted = out.deleted;
        singleKey = out.key;
        console.log("[reset:job-view-quota] target IP:", resetIp, "key:", out.key);
      } else {
        const out = await deleteAnonViewCapKeys(redis);
        redisFound = out.found;
        redisDeleted = out.deleted;
      }
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
        usersUpdated,
        redisAnonKeysFound: redisFound,
        redisAnonKeysDeleted: redisDeleted,
        singleKey,
        note:
          redisUrl && redisFound === 0 && !resetIp
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
