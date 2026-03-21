import { loadRootEnv } from "../../infrastructure/env/loadEnv.js";
import { logger } from "../../utils/logger.js";
import { getDiscoveryQueue } from "../../queues/discovery.queue.js";
import {
  DISCOVER_SOURCE,
  type DiscoverySourceType,
} from "./discovery.types.js";
import { discoverySources } from "./discovery.service.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SOURCES: DiscoverySourceType[] = discoverySources.map((s) => s.source);

async function runOnce(): Promise<void> {
  const queue = getDiscoveryQueue();

  logger.info({ event: "discovery_start" }, "Company discovery scheduler started");

  let jobs = 0;
  for (const source of SOURCES) {
    await queue.add(DISCOVER_SOURCE, { source }, { jobId: `discover-${source}` });
    jobs += 1;
  }

  logger.info({ event: "discovery_summary", sources: SOURCES.length, jobs_enqueued: jobs }, "Discovery scheduler run completed");
}

async function main(): Promise<void> {
  loadRootEnv();
  await runOnce();
  setInterval(() => {
    void runOnce().catch((err) => {
      logger.error({ event: "discovery_scheduler_failed", err }, "Discovery scheduler run failed");
    });
  }, SIX_HOURS_MS);
}

void main();
