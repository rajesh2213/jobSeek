import { buildServer } from "./server/fastify.js";
import { logger } from "./utils/logger.js";
import { loadRootEnv } from "./infrastructure/env/loadEnv.js";
import { assertApiProcessEnv } from "./infrastructure/env/validateApiEnv.js";
import { prisma } from "./infrastructure/db/prisma.js";
import { ensureAtsEndpointTableReady } from "./modules/atsEndpoint/atsEndpointReadiness.js";

loadRootEnv();

async function main() {
  const { port } = assertApiProcessEnv();

  await ensureAtsEndpointTableReady(prisma, "server_boot");
  const server = await buildServer();

  try {
    await server.listen({ port, host: "0.0.0.0" });
    server.log.info({ port, event: "server_listen" }, "Server listening");

    /** Optional; avoid heavy `/companies` agg on boot — it competes with live traffic for DB pool slots. */
    const warmupUrl = process.env.JOBSEEK_BOOT_WARMUP_URL?.trim();
    if (warmupUrl) {
      fetch(warmupUrl)
        .then(() => server.log.info({ event: "boot_warmup_done", url: warmupUrl }, "boot_warmup_done"))
        .catch((err) =>
          server.log.warn({ event: "boot_warmup_failed", err: String(err) }, "boot_warmup_failed"),
        );
    }

    if (process.env.LISTING_CACHE_WARMUP_ENABLED !== "0") {
      const base = `http://127.0.0.1:${port}`;
      const warmListingCaches = () => {
        fetch(`${base}/jobs?page=1&limit=20`)
          .catch(() => undefined);
        fetch(`${base}/companies?page=1&limit=20`)
          .catch(() => undefined);
      };
      setTimeout(warmListingCaches, 45_000);
      setInterval(warmListingCaches, 90_000);
    }
  } catch (err) {
    logger.error({ err, event: "server_listen_failed" }, "Server failed to start");
    process.exit(1);
    return;
  }

  const shutdown = async (signal: string) => {
    server.log.info({ signal, event: "server_shutdown_start" }, "server_shutdown_start");
    try {
      await server.close();
    } catch (err) {
      logger.error({ err, signal, event: "server_shutdown_error" }, "server_shutdown_error");
    }
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((err) => {
  logger.error({ err, event: "server_bootstrap_failed" }, "Server bootstrap failed");
  process.exit(1);
});
