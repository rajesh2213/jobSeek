import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "./logger.js";
import {
  clearRequestCallerType,
  registerRequestCallerType,
  trackEgressWithCallerType,
  type CallerType,
} from "./egressTracker.js";

const HIGH_EGRESS_PATH_HINTS = ["/jobs", "search", "list", "discover", "explore", "suggest"];
const TRACE_ROUTES = new Set(["/jobs", "/companies", "/company/:slug/jobs"]);
const TRAFFIC_SUMMARY_MS = 60_000;
const SSR_HOTSPOT_MS = 5 * 60_000;
const SUSPICIOUS_PER_MINUTE = 100;
const SUSPICIOUS_PER_HOUR = 1000;
const MAX_TOP_LIST = 10;

type RequestWithMetrics = FastifyRequest & {
  _apiMetricsT0?: number;
  _apiRequestId?: string;
};
type CallerStats = Record<CallerType, number>;

const CALLER_TYPES: CallerType[] = [
  "internal_ssr",
  "local_internal",
  "external_node_bot",
  "browser",
  "unknown",
];

function callerStatsZero(): CallerStats {
  return {
    internal_ssr: 0,
    local_internal: 0,
    external_node_bot: 0,
    browser: 0,
    unknown: 0,
  };
}

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

function pickTopNByCallerType(
  grouped: Map<CallerType, Map<string, number>>,
  mapper: (key: string, count: number) => Record<string, unknown>,
): Record<CallerType, Array<Record<string, unknown>>> {
  const out = {} as Record<CallerType, Array<Record<string, unknown>>>;
  for (const callerType of CALLER_TYPES) {
    const map = grouped.get(callerType) ?? new Map<string, number>();
    out[callerType] = pickTopN(map).map((row) => mapper(row.key, row.count));
  }
  return out;
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

function firstHeaderValue(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return "";
}

function botHeuristic(userAgent: string): boolean {
  return /(bot|crawler|spider|scrapy|curl|wget|python|axios|node-fetch)/i.test(userAgent);
}

function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return false;
}

function classifyCallerType(input: {
  hasSsrOrigin: boolean;
  isInternal: boolean;
  isBot: boolean;
  userAgent: string;
  isLikelyBrowser: boolean;
}): CallerType {
  if (input.hasSsrOrigin) return "internal_ssr";
  if (input.isInternal) return "local_internal";
  if (input.isBot && input.userAgent.toLowerCase().includes("node")) return "external_node_bot";
  if (input.isLikelyBrowser) return "browser";
  return "unknown";
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
  const routeCallerStats = new Map<string, CallerStats>();
  const ipCounter = new Map<string, number>();
  const uaCounter = new Map<string, number>();
  const ipMinuteUa = new Map<string, string>();
  const ipHourlyBuckets = new Map<string, number[]>();
  const ipByCallerType = new Map<CallerType, Map<string, number>>();
  const uaByCallerType = new Map<CallerType, Map<string, number>>();
  const ssrRouteCounter = new Map<string, number>();
  const ssrPageCounter = new Map<string, number>();
  const ssrRenderKeyCounter = new Map<string, number>();
  const ssrLoopCounter = new Map<string, number>();

  for (const callerType of CALLER_TYPES) {
    ipByCallerType.set(callerType, new Map<string, number>());
    uaByCallerType.set(callerType, new Map<string, number>());
  }

  const flushTrafficSummary = (): void => {
    const routes = [...routeStats.entries()].sort((a, b) => b[1].total - a[1].total);
    const routeStatsObj: Record<string, { total: number; bots: number; humans: number }> = {};
    for (const [route, stats] of routes) {
      routeStatsObj[route] = stats;
    }
    const perRouteStats: Record<string, { total: number; byCallerType: CallerStats }> = {};
    for (const [route, callerStats] of routeCallerStats.entries()) {
      const total = routeStats.get(route)?.total ?? 0;
      perRouteStats[route] = {
        total,
        byCallerType: callerStats,
      };
    }

    const topIPs = pickTopN(ipCounter).map((row) => ({ ip: row.key, count: row.count }));
    const topUserAgents = pickTopN(uaCounter).map((row) => ({ ua: row.key, count: row.count }));
    const topIPsByCallerType = pickTopNByCallerType(ipByCallerType, (ip, count) => ({ ip, count }));
    const topUserAgentsByCallerType = pickTopNByCallerType(uaByCallerType, (ua, count) => ({
      ua,
      count,
    }));

    logger.info(
      {
        event: "api_traffic_summary",
        routeStats: routeStatsObj,
        perRouteStats,
        topIPs,
        topUserAgents,
        topIPsByCallerType,
        topUserAgentsByCallerType,
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
    routeCallerStats.clear();
    ipCounter.clear();
    uaCounter.clear();
    ipMinuteUa.clear();
  };

  const flushSsrHotspotAnalysis = (): void => {
    const topSsrRoutes = pickTopN(ssrRouteCounter).map((row) => ({ route: row.key, count: row.count }));
    const topSsrPages = pickTopN(ssrPageCounter).map((row) => ({ page: row.key, count: row.count }));
    const totalSsrApiCalls = [...ssrPageCounter.values()].reduce((sum, n) => sum + n, 0);
    const totalSsrRenderWindows = ssrRenderKeyCounter.size;
    const avgRequestsPerSsrRender =
      totalSsrRenderWindows > 0 ? Number((totalSsrApiCalls / totalSsrRenderWindows).toFixed(2)) : 0;
    const loopsDetected = [...ssrLoopCounter.entries()]
      .filter(([, count]) => count > 10)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOP_LIST)
      .map(([key, count]) => {
        const split = key.split("|");
        const page = split[0] ?? "(unknown)";
        const windowStartSec = split[1] ?? "";
        return { page, windowStartSec, count };
      });

    logger.info(
      {
        event: "ssr_hotspot_analysis",
        topSsrRoutes,
        topSsrPages,
        avgRequestsPerSsrRender,
        loopsDetected,
      },
      "ssr_hotspot_analysis",
    );

    ssrRouteCounter.clear();
    ssrPageCounter.clear();
    ssrRenderKeyCounter.clear();
    ssrLoopCounter.clear();
  };

  const summaryTimer = setInterval(flushTrafficSummary, TRAFFIC_SUMMARY_MS);
  summaryTimer.unref?.();
  const ssrHotspotTimer = setInterval(flushSsrHotspotAnalysis, SSR_HOTSPOT_MS);
  ssrHotspotTimer.unref?.();

  server.addHook("onRequest", (request: RequestWithMetrics, _reply, done) => {
    request._apiMetricsT0 = Date.now();
    request._apiRequestId = randomUUID();
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
    const requestId = request._apiRequestId ?? randomUUID();
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
    const userAgent = firstHeaderValue(request.headers["user-agent"]);
    const referer = firstHeaderValue(request.headers.referer);
    const origin = firstHeaderValue(request.headers.origin);
    const host = firstHeaderValue(request.headers.host);
    const accept = firstHeaderValue(request.headers.accept);
    const acceptEncoding = firstHeaderValue(request.headers["accept-encoding"]);
    const connection = firstHeaderValue(request.headers.connection);
    const ssrOrigin = firstHeaderValue(request.headers["x-ssr-origin"]);
    const ssrPage = firstHeaderValue(request.headers["x-ssr-page"]) || "(unspecified)";
    const hasSsrOrigin = ssrOrigin.length > 0;
    const isBot = botHeuristic(userAgent);
    const isInternal = isPrivateIp(ip);
    const isSSR =
      userAgent.toLowerCase().includes("node") &&
      referer.trim() === "" &&
      (accept.includes("text/html") || accept.includes("*/*"));
    const isLikelyBrowser =
      /(Chrome|Safari|Firefox)/i.test(userAgent) && referer.trim().length > 0;
    const callerType = classifyCallerType({
      hasSsrOrigin,
      isInternal,
      isBot,
      userAgent,
      isLikelyBrowser,
    });

    const rs = routeStats.get(route) ?? { total: 0, bots: 0, humans: 0 };
    rs.total += 1;
    if (isBot) rs.bots += 1;
    else rs.humans += 1;
    routeStats.set(route, rs);
    ipCounter.set(ip, (ipCounter.get(ip) ?? 0) + 1);
    ipMinuteUa.set(ip, userAgent);
    const uaKey = userAgent || "(missing)";
    uaCounter.set(uaKey, (uaCounter.get(uaKey) ?? 0) + 1);
    const callerRoute = routeCallerStats.get(route) ?? callerStatsZero();
    callerRoute[callerType] += 1;
    routeCallerStats.set(route, callerRoute);
    const callerIpCounter = ipByCallerType.get(callerType);
    if (callerIpCounter) callerIpCounter.set(ip, (callerIpCounter.get(ip) ?? 0) + 1);
    const callerUaCounter = uaByCallerType.get(callerType);
    if (callerUaCounter) callerUaCounter.set(uaKey, (callerUaCounter.get(uaKey) ?? 0) + 1);

    registerRequestCallerType(requestId, callerType);
    if (estimatedKB != null && estimatedKB > 0) {
      trackEgressWithCallerType(estimatedKB, {
        source: "manual",
        requestId,
      });
    }

    if (callerType === "internal_ssr") {
      ssrRouteCounter.set(route, (ssrRouteCounter.get(route) ?? 0) + 1);
      ssrPageCounter.set(ssrPage, (ssrPageCounter.get(ssrPage) ?? 0) + 1);
      const secWindow = Math.floor(Date.now() / 1000);
      const renderKey = `${ssrPage}|${ip}|${secWindow}`;
      ssrRenderKeyCounter.set(renderKey, (ssrRenderKeyCounter.get(renderKey) ?? 0) + 1);
      const loopKey = `${ssrPage}|${secWindow}`;
      ssrLoopCounter.set(loopKey, (ssrLoopCounter.get(loopKey) ?? 0) + 1);
    }

    if (TRACE_ROUTES.has(route)) {
      logger.info(
        {
          event: "api_request_trace_extended",
          requestId,
          route,
          method,
          ip,
          userAgent,
          referer,
          origin,
          host,
          accept,
          acceptEncoding,
          connection,
          isBot,
          isInternal,
          isSSR,
          isLikelyBrowser,
          callerType,
          ssrOrigin: hasSsrOrigin ? ssrOrigin : undefined,
          ssrPage: hasSsrOrigin ? ssrPage : undefined,
          durationMs,
          estimatedKB: estimatedKB != null ? Number(estimatedKB.toFixed(2)) : undefined,
        },
        "api_request_trace_extended",
      );
    }

    clearRequestCallerType(requestId);
    done();
  });

  server.addHook("onClose", (_instance, done) => {
    clearInterval(summaryTimer);
    clearInterval(ssrHotspotTimer);
    done();
  });
}
