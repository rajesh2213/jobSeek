import { spawn } from "node:child_process";
import readline from "node:readline";

type CallerType =
  | "internal_ssr"
  | "local_internal"
  | "external_node_bot"
  | "browser"
  | "unknown";

type JsonRecord = Record<string, unknown>;

const callerTypes: CallerType[] = [
  "internal_ssr",
  "local_internal",
  "external_node_bot",
  "browser",
  "unknown",
];

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseJsonLine(line: string): JsonRecord | null {
  try {
    return JSON.parse(line) as JsonRecord;
  } catch {
    return null;
  }
}

function extractMessagePayload(row: JsonRecord): JsonRecord | null {
  const msg = row.MESSAGE;
  if (typeof msg !== "string" || !msg.trim().startsWith("{")) return null;
  return parseJsonLine(msg.trim());
}

function topN(counter: Map<string, number>, n = 10): Array<{ key: string; count: number }> {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

async function streamJournal(
  sinceHours: number,
  units: string[],
  onPayload: (payload: JsonRecord) => void,
): Promise<void> {
  const args = ["--since", `${sinceHours} hours ago`, "-o", "json", ...units.flatMap((u) => ["-u", u])];
  const child = spawn("journalctl", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rl = readline.createInterface({ input: child.stdout });
  for await (const line of rl) {
    const row = parseJsonLine(line);
    if (!row) continue;
    const payload = extractMessagePayload(row);
    if (!payload) continue;
    onPayload(payload);
  }

  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`journalctl failed (${code}): ${stderr}`));
    });
  });
}

async function main(): Promise<void> {
  const hours = Number(process.argv[2] ?? "6");
  const sinceHours = Number.isFinite(hours) && hours > 0 ? hours : 6;

  const trafficByCaller = new Map<string, number>();
  const egressByCaller = new Map<string, number>();
  const topIpsByCaller = new Map<string, Map<string, number>>();
  const topRoutesByEgress = new Map<string, number>();
  const topRoutesByHits = new Map<string, number>();
  const repeatedQuery = new Map<string, number>();
  const burstByIpMinute = new Map<string, number>();

  const ssrRequestsByPage = new Map<string, number>();
  let ssrApiCalls = 0;

  for (const c of callerTypes) {
    trafficByCaller.set(c, 0);
    egressByCaller.set(c, 0);
    topIpsByCaller.set(c, new Map<string, number>());
  }

  const apiUnits = ["jobseek-api"];
  await streamJournal(sinceHours, apiUnits, (payload) => {
    const event = String(payload.event ?? "");

    if (event === "api_request_trace_extended") {
      const callerType = String(payload.callerType || "unknown");
      const ip = String(payload.ip || "unknown");
      const route = String(payload.route || "unknown");
      const ua = String(payload.userAgent || "");
      const referer = String(payload.referer || "");
      const requestId = String(payload.requestId || "");
      const ssrPage = String(payload.ssrPage || "");
      const estimatedKB = asNumber(payload.estimatedKB);

      trafficByCaller.set(callerType, (trafficByCaller.get(callerType) ?? 0) + 1);
      const ipCounter = topIpsByCaller.get(callerType) ?? new Map<string, number>();
      ipCounter.set(ip, (ipCounter.get(ip) ?? 0) + 1);
      topIpsByCaller.set(callerType, ipCounter);
      topRoutesByHits.set(route, (topRoutesByHits.get(route) ?? 0) + 1);
      topRoutesByEgress.set(route, (topRoutesByEgress.get(route) ?? 0) + estimatedKB);

      if (callerType === "internal_ssr") {
        ssrApiCalls += 1;
        if (ssrPage) ssrRequestsByPage.set(ssrPage, (ssrRequestsByPage.get(ssrPage) ?? 0) + 1);
      }

      if (ua.toLowerCase().includes("node") && referer.trim() === "") {
        const key = `${ip}|${route}`;
        repeatedQuery.set(key, (repeatedQuery.get(key) ?? 0) + 1);
      }

      if (requestId) {
        const minuteBucket = Math.floor(asNumber(payload.time) / 60000);
        if (minuteBucket > 0) {
          const burstKey = `${ip}|${minuteBucket}`;
          burstByIpMinute.set(burstKey, (burstByIpMinute.get(burstKey) ?? 0) + 1);
        }
      }
    }

    if (event === "egress_hourly") {
      const byCaller = payload.egressByCallerType as JsonRecord | undefined;
      if (!byCaller || typeof byCaller !== "object") return;
      for (const c of callerTypes) {
        const cObj = byCaller[c] as JsonRecord | undefined;
        if (!cObj || typeof cObj !== "object") continue;
        const mb = asNumber(cObj.totalMB);
        egressByCaller.set(c, (egressByCaller.get(c) ?? 0) + mb);
      }
    }
  });

  const totalTraffic = [...trafficByCaller.values()].reduce((a, b) => a + b, 0);
  const totalEgress = [...egressByCaller.values()].reduce((a, b) => a + b, 0);
  const ssrRenderEstimate = [...ssrRequestsByPage.values()].reduce((a, b) => a + b, 0);
  const ssrAmplification = ssrRenderEstimate > 0 ? ssrApiCalls / ssrRenderEstimate : 0;

  const suspiciousNoRefererNode = [...repeatedQuery.entries()]
    .filter(([, count]) => count > 20)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  const burstPatterns = [...burstByIpMinute.entries()]
    .filter(([, count]) => count > 40)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  const trafficPct: Record<string, number> = {};
  const egressPct: Record<string, number> = {};
  for (const c of callerTypes) {
    const t = trafficByCaller.get(c) ?? 0;
    const e = egressByCaller.get(c) ?? 0;
    trafficPct[c] = totalTraffic > 0 ? Number(((t * 100) / totalTraffic).toFixed(2)) : 0;
    egressPct[c] = totalEgress > 0 ? Number(((e * 100) / totalEgress).toFixed(2)) : 0;
  }

  const report = {
    sinceHours,
    trafficByCallerTypePct: trafficPct,
    egressByCallerTypePct: egressPct,
    topIpsByCallerType: Object.fromEntries(
      [...topIpsByCaller.entries()].map(([k, v]) => [k, topN(v).map((x) => ({ ip: x.key, count: x.count }))]),
    ),
    topRoutesByEgressKB: topN(topRoutesByEgress).map((x) => ({
      route: x.key,
      estimatedKB: Number(x.count.toFixed(2)),
    })),
    topRoutesByHits: topN(topRoutesByHits).map((x) => ({ route: x.key, count: x.count })),
    ssrAmplificationFactor: Number(ssrAmplification.toFixed(3)),
    suspiciousPatterns: {
      noRefererNodeRepeated: suspiciousNoRefererNode,
      burstPatterns,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

