import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "./logger.js";

const HIGH_EGRESS_PATH_HINTS = ["/jobs", "search", "list", "discover", "explore", "suggest"];
const TRACE_ROUTES = new Set(["/jobs", "/companies", "/company/:slug/jobs"]);
const TRAFFIC_SUMMARY_MS = 60_000;
const SUSPICIOUS_PER_MINUTE = 100;
const SUSPICIOUS_PER_HOUR = 1000;
const MAX_TOP_LIST = 10;

type RequestWithMetrics = FastifyRequest & { _apiMetricsT0?: number };

function isHighEgressPath(path: string): boolean {
  const p = path.toLowerCase();
  return HIGH_EGRESS_PATH_HINTS.some((h) => p.includes(h));
}

function pickTopN(counter: Map<string, number>, n = MAX_TOP_LIST): Array<{ key: string; count: number }> {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function extractClientIp(request: FastifyRequest): string {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim() !== "") {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xff) && xff.length > 0) {
    const first = String(xff[0] ?? "").split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

function botHeuristic(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("bot") ||
    ua.includes("crawler") ||
    ua.includes("spider") ||
    ua.includes("curl") ||
    ua.includes("python") ||
    ua.includes("scrapy")
  );
}

/**
 * One structured line per request: route, duration, approx response size (Content-Length if set).
 * `API_REQUEST_METRICS=0` disables. `API_REQUEST_METRICS=selective` logs only
 * `durationMs >= API_REQUEST_LOG_MIN_MS` and paths that look like listings/search.
 */
export function registerApiRequestMetrics(server: FastifyInstance): void {
  if (process.env.API_REQUEST_METRICS === "0") return;

  const mode = process.env.API_REQUEST_METRICS ?? "1";
  const selective = mode === "selective" || mode === "sample";
  const minSlowMs = Number(process.env.API_REQUEST_LOG_MIN_MS ?? "500");
  const routeStats = new Map<string, { total: number; bots: number; humans: number }>();
  const ipCounter = new Map<string, number>();
  const uaCounter = new Map<string, number>();
  const ipMinuteUa = new Map<string, string>();
  const ipHourlyBuckets = new Map<string, number[]>();

  const flushTrafficSummary = (): void => {
    const routes = [...routeStats.entries()].sort((a, b) => b[1].total - a[1].total);
    const routeStatsObj: Record<string, { total: number; bots: number; humans: number }> = {};
    for (const [route, stats] of routes) {
      routeStatsObj[route] = stats;
    }

    const topIPs = pickTopN(ipCounter).map((row) => ({ ip: row.key, count: row.count }));
    const topUserAgents = pickTopN(uaCounter).map((row) => ({ ua: row.key, count: row.count }));

    logger.info(
      {
        event: "api_traffic_summary",
        routeStats: routeStatsObj,
        topIPs,
        topUserAgents,
      },
      "api_traffic_summary",
    );

    for (const [ip, perMinute] of ipCounter.entries()) {
      const ua = ipMinuteUa.get(ip) ?? "";
      if (perMinute > SUSPICIOUS_PER_MINUTE) {
        logger.warn(
          {
            event: "suspicious_client",
            ip,
            scope: "minute",
            count: perMinute,
            userAgent: ua,
          },
          "suspicious_client",
        );
      }
      const buckets = ipHourlyBuckets.get(ip) ?? [];
      buckets.push(perMinute);
      while (buckets.length > 60) buckets.shift();
      ipHourlyBuckets.set(ip, buckets);
      const hourly = buckets.reduce((sum, v) => sum + v, 0);
      if (hourly > SUSPICIOUS_PER_HOUR) {
        logger.warn(
          {
            event: "suspicious_client",
            ip,
            scope: "hour",
            count: hourly,
            userAgent: ua,
          },
          "suspicious_client",
        );
      }
    }

    routeStats.clear();
    ipCounter.clear();
    uaCounter.clear();
    ipMinuteUa.clear();
  };

  const summaryTimer = setInterval(flushTrafficSummary, TRAFFIC_SUMMARY_MS);
  summaryTimer.unref?.();

  server.addHook("onRequest", (request: RequestWithMetrics, _reply, done) => {
    request._apiMetricsT0 = Date.now();
    done();
  });

  server.addHook("onResponse", (request: RequestWithMetrics, reply: FastifyReply, done) => {
    const t0 = request._apiMetricsT0;
    if (t0 == null) {
      done();
      return;
    }
    const route =
      (request as FastifyRequest & { routerPath?: string }).routerPath && typeof (request as FastifyRequest & { routerPath: string }).routerPath === "string"
        ? (request as FastifyRequest & { routerPath: string }).routerPath
        : request.url.split("?")[0] ?? request.url;
    const method = request.method;
    const durationMs = Date.now() - t0;
    const pathOnly = request.url.split("?")[0] ?? request.url;
    const cl = reply.getHeader("content-length");
    const responseBytes = typeof cl === "string" && cl !== "" ? Number(cl) : undefined;
    const highPath = isHighEgressPath(pathOnly);

    if (selective) {
      const minSlow = Number.isFinite(minSlowMs) && minSlowMs > 0 ? minSlowMs : 500;
      if (durationMs < minSlow && !highPath) {
        done();
        return;
      }
    }

    const estimatedKB = responseBytes != null && Number.isFinite(responseBytes) ? responseBytes / 1024 : undefined;
    const payload: Record<string, unknown> = {
      event: "api_request_metrics",
      method,
      route,
      statusCode: reply.statusCode,
      durationMs,
    };
    if (responseBytes != null) payload.responseBytes = responseBytes;
    if (estimatedKB != null) payload.estimatedKB = Number(estimatedKB.toFixed(2));
    if (highPath) payload.egressHint = "high_egress_path";

    logger.info(payload, "api_request_metrics");

    const ip = extractClientIp(request);
    const userAgentRaw = request.headers["user-agent"];
    const refererRaw = request.headers.referer;
    const userAgent =
      typeof userAgentRaw === "string"
        ? userAgentRaw
        : Array.isArray(userAgentRaw)
          ? String(userAgentRaw[0] ?? "")
          : "";
    const referer =
      typeof refererRaw === "string"
        ? refererRaw
        : Array.isArray(refererRaw)
          ? String(refererRaw[0] ?? "")
          : "";
    const isBot = botHeuristic(userAgent);

    const rs = routeStats.get(route) ?? { total: 0, bots: 0, humans: 0 };
    rs.total += 1;
    if (isBot) rs.bots += 1;
    else rs.humans += 1;
    routeStats.set(route, rs);
    ipCounter.set(ip, (ipCounter.get(ip) ?? 0) + 1);
    ipMinuteUa.set(ip, userAgent);
    const uaKey = userAgent || "(missing)";
    uaCounter.set(uaKey, (uaCounter.get(uaKey) ?? 0) + 1);

    if (TRACE_ROUTES.has(route)) {
      logger.info(
        {
          event: "api_request_trace",
          route,
          method,
          ip,
          userAgent,
          referer,
          isBot,
          durationMs,
          estimatedKB: estimatedKB != null ? Number(estimatedKB.toFixed(2)) : undefined,
        },
        "api_request_trace",
      );
    }

    done();
  });

  server.addHook("onClose", (_instance, done) => {
    clearInterval(summaryTimer);
    done();
  });
}
