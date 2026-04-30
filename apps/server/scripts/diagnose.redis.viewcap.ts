import "./scriptEnv.js";

/**
 * Print Redis connectivity + all anonymous view-cap keys (signed-out /jobs quota).
 * Use when reset script finds 0 keys but UI still shows a capped anon quota —
 * usually REDIS_URL mismatch vs the running API, or wrong logical DB index.
 */
import { Redis } from "ioredis";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { getIoredis } from "../src/queues/job.queue.js";
import { getJobViewCapState } from "../src/modules/viewCap/viewCap.service.js";
import { LIMITS } from "../src/config/limits.js";

function redisEndpointMasked(urlStr: string): string {
  try {
    const normalized = urlStr.includes("://") ? urlStr : `redis://${urlStr}`;
    const u = new URL(normalized);
    const db = (u.pathname || "/").replace("/", "") || "0";
    let auth = "";
    if (u.username || u.password) {
      auth = u.password ? `${u.username || "default"}:****@` : `${u.username}@`;
    }
    const port = u.port || "6379";
    return `${u.hostname}:${port} db=${db} (${u.protocol}//${auth}${u.hostname}:${port})`;
  } catch {
    return "(could not parse REDIS_URL)";
  }
}

async function main(): Promise<void> {
  const apiPublic = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const apiSsr = process.env.API_BASE_URL?.trim();
  if (apiPublic || apiSsr) {
    console.log(
      "[diagnose:redis-viewcap] Client/API URLs from .env:",
      JSON.stringify({
        NEXT_PUBLIC_API_BASE_URL: apiPublic ?? null,
        API_BASE_URL: apiSsr ?? null,
      }),
    );
    console.log(
      "[diagnose:redis-viewcap] If the browser hits a remote API, reset LOCAL Redis here will NOT clear that API's anon quota.",
    );
  }

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    console.error("[diagnose:redis-viewcap] REDIS_URL is not set (repo root .env)");
    process.exitCode = 1;
    return;
  }

  console.log("[diagnose:redis-viewcap] endpoint:", redisEndpointMasked(redisUrl));

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  try {
    console.log("[diagnose:redis-viewcap] LIMITS:", JSON.stringify({
      mode: LIMITS.MODE,
      freeTierDailyLimit: LIMITS.FREE_TIER_DAILY_LIMIT,
      previewRows: LIMITS.DISCOVERY.PREVIEW_ROWS,
    }));
    console.log("[diagnose:redis-viewcap] PING:", await redis.ping());
    console.log("[diagnose:redis-viewcap] DBSIZE:", await redis.dbsize());
    const keysAny = await redis.keys("viewcap:*");
    console.log("[diagnose:redis-viewcap] viewcap:* count:", keysAny.length);
    const keys = await redis.keys("viewcap:anon:*");
    console.log("[diagnose:redis-viewcap] viewcap:anon:* count:", keys.length);
    for (const k of keys.slice(0, 80)) {
      const [v, ttl] = await Promise.all([redis.get(k), redis.ttl(k)]);
      console.log(`  ${k} used=${v ?? "(nil)"} ttlSeconds=${ttl}`);
    }
    if (keys.length > 80) {
      console.log(`  ... ${keys.length - 80} more keys omitted`);
    }
    if (keys.length === 0) {
      console.log(
        "[diagnose:redis-viewcap] No anon keys here — if Fastify still caps signed-out traffic, it is almost certainly using a different REDIS_URL or Redis logical DB.",
      );
    }
    const serverRedis = getIoredis();
    const probeUnknown = await getJobViewCapState(prisma, serverRedis, { ip: "unknown" });
    const probeLoopback = await getJobViewCapState(prisma, serverRedis, { ip: "::1" });
    const probeLocalhost = await getJobViewCapState(prisma, serverRedis, { ip: "127.0.0.1" });
    console.log(
      "[diagnose:redis-viewcap] getJobViewCapState probes:",
      JSON.stringify(
        {
          unknown: { unlimited: probeUnknown.unlimited, remaining: probeUnknown.remaining },
          "::1": { unlimited: probeLoopback.unlimited, remaining: probeLoopback.remaining },
          "127.0.0.1": { unlimited: probeLocalhost.unlimited, remaining: probeLocalhost.remaining },
        },
        null,
        2,
      ),
    );
  } finally {
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch((err) => {
  console.error("[diagnose:redis-viewcap] failed", err);
  process.exitCode = 1;
});
