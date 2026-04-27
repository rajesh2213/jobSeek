import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "./logger.js";

const HIGH_EGRESS_PATH_HINTS = ["/jobs", "search", "list", "discover", "explore", "suggest"];

type RequestWithMetrics = FastifyRequest & { _apiMetricsT0?: number };

function isHighEgressPath(path: string): boolean {
  const p = path.toLowerCase();
  return HIGH_EGRESS_PATH_HINTS.some((h) => p.includes(h));
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
    done();
  });
}
