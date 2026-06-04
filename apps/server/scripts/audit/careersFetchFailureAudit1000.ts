/**
 * Classify careers page fetch failures for companies without endpoints.
 * Usage: cd apps/server && npx tsx scripts/audit/careersFetchFailureAudit1000.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { asyncPool } from "../../src/utils/asyncPool.js";

loadRootEnv();

const SAMPLE_SIZE = 1000;
const CONCURRENCY = 14;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 12;
const TINY_HTML_BYTES = 5_000;

const DEFAULT_UA = "Mozilla/5.0 (compatible; JobSeekBot/1.0; +https://jobseek.com/bot)";

type FailureCategory =
  | "dns_failure"
  | "timeout"
  | "ssl_failure"
  | "redirect_loop"
  | "403"
  | "404"
  | "429"
  | "bot_protection"
  | "cloudflare_challenge"
  | "marketing_page_redirect"
  | "login_required"
  | "empty_html"
  | "tiny_html"
  | "other";

type RecoveryHints = {
  playwright: "YES" | "NO";
  retries: "YES" | "NO";
  userAgent: "YES" | "NO";
  proxy: "YES" | "NO";
  redirectRepair: "YES" | "NO";
};

type AuditRow = {
  companyId: string;
  careersUrl: string;
  fetchOk: boolean;
  category: FailureCategory | "success";
  httpStatus: number | null;
  finalUrl: string | null;
  htmlLength: number;
  errorMessage: string | null;
  redirectCount: number;
};

type FetchProbe = {
  ok: boolean;
  httpStatus: number | null;
  html: string;
  finalUrl: string;
  errorMessage: string | null;
  redirectCount: number;
  redirectChain: string[];
  cfRay: boolean;
  serverHeader: string | null;
};

function classifyErrorMessage(msg: string): FailureCategory | null {
  const m = msg.toLowerCase();
  if (
    m.includes("enotfound") ||
    m.includes("getaddrinfo") ||
    m.includes("eai_again") ||
    m.includes("name not resolved") ||
    m.includes("dns")
  ) {
    return "dns_failure";
  }
  if (
    m.includes("certificate") ||
    m.includes("ssl") ||
    m.includes("tls") ||
    m.includes("unable to verify") ||
    m.includes("cert_") ||
    m.includes("self signed") ||
    m.includes("err_ssl")
  ) {
    return "ssl_failure";
  }
  if (
    m.includes("timeout") ||
    m.includes("aborted") ||
    m.includes("abort") ||
    m.includes("etimedout") ||
    m.includes("timed out")
  ) {
    return "timeout";
  }
  if (m.includes("redirect") || m.includes("too many redirects")) {
    return "redirect_loop";
  }
  return null;
}

function isCloudflareHtml(html: string, headers: Headers): boolean {
  if (headers.get("cf-ray") || headers.get("server")?.toLowerCase().includes("cloudflare")) {
    return true;
  }
  const lower = html.toLowerCase();
  return (
    lower.includes("cf-browser-verification") ||
    lower.includes("challenge-platform") ||
    lower.includes("checking your browser") ||
    lower.includes("just a moment") ||
    lower.includes("/cdn-cgi/challenge") ||
    lower.includes("attention required! | cloudflare") ||
    (lower.includes("cloudflare") && lower.includes("ray id"))
  );
}

function isBotProtectionHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("datadome") ||
    lower.includes("perimeterx") ||
    lower.includes("distilnetworks") ||
    lower.includes("incapsula") ||
    lower.includes("akamai") && lower.includes("access denied") ||
    lower.includes("please enable javascript") && lower.includes("bot") ||
    lower.includes("captcha") && lower.includes("verify you are human") ||
    lower.includes("access denied") && lower.includes("automated") ||
    lower.includes("blocked") && lower.includes("security service") ||
    lower.includes("px-captcha") ||
    lower.includes("hcaptcha") && lower.length < TINY_HTML_BYTES
  );
}

function isLoginRequired(html: string, finalUrl: string): boolean {
  const urlLower = finalUrl.toLowerCase();
  if (
    /\/(login|signin|sign-in|auth|sso|account\/login|users\/sign_in)(\/|$|\?)/i.test(urlLower)
  ) {
    return true;
  }
  const lower = html.toLowerCase();
  const hasPassword = lower.includes('type="password"') || lower.includes("type='password'");
  const hasLoginForm =
    (lower.includes("log in") || lower.includes("sign in") || lower.includes("login")) &&
    hasPassword;
  return hasLoginForm && html.length < 80_000;
}

const CAREERS_PATH_RE =
  /\/(careers?|jobs?|join-us|join_us|work-with-us|vacancies|opportunities|hiring|recruit|employment)(\/|$|\?|#)/i;

function isMarketingRedirect(startUrl: string, finalUrl: string, html: string): boolean {
  try {
    const start = new URL(startUrl);
    const end = new URL(finalUrl);
    const startHost = start.hostname.replace(/^www\./, "");
    const endHost = end.hostname.replace(/^www\./, "");
    const sameSite = startHost === endHost || endHost.endsWith(`.${startHost}`);
    if (!sameSite) return false;

    const startHasCareers = CAREERS_PATH_RE.test(start.pathname) || /career|jobs?/i.test(start.pathname);
    const endHasCareers = CAREERS_PATH_RE.test(end.pathname);
    const endIsHome = end.pathname === "/" || end.pathname === "";
    if (startHasCareers && (endIsHome || !endHasCareers)) return true;

    const lower = html.toLowerCase();
    const jobDensity = (lower.match(/\b(job|career|position|opening|apply|hiring)\b/g) ?? []).length;
    if (startHasCareers && jobDensity < 6 && html.length > 20_000) return true;
  } catch {
    return false;
  }
  return false;
}

async function probeUrl(url: string, userAgent: string): Promise<FetchProbe> {
  const redirectChain: string[] = [url];
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": userAgent,
        },
      });
      clearTimeout(timer);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return {
            ok: false,
            httpStatus: res.status,
            html: "",
            finalUrl: current,
            errorMessage: `Redirect ${res.status} without Location`,
            redirectCount: hop,
            redirectChain,
            cfRay: false,
            serverHeader: res.headers.get("server"),
          };
        }
        const next = new URL(loc, current).toString();
        if (redirectChain.includes(next)) {
          return {
            ok: false,
            httpStatus: res.status,
            html: "",
            finalUrl: next,
            errorMessage: "Redirect loop detected",
            redirectCount: hop + 1,
            redirectChain: [...redirectChain, next],
            cfRay: false,
            serverHeader: res.headers.get("server"),
          };
        }
        redirectChain.push(next);
        current = next;
        continue;
      }

      const html = await res.text();
      const serverHeader = res.headers.get("server");
      const cfRay = Boolean(res.headers.get("cf-ray"));
      return {
        ok: res.ok,
        httpStatus: res.status,
        html,
        finalUrl: current,
        errorMessage: res.ok ? null : `HTTP ${res.status}`,
        redirectCount: hop,
        redirectChain,
        cfRay,
        serverHeader,
      };
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        httpStatus: null,
        html: "",
        finalUrl: current,
        errorMessage: msg,
        redirectCount: hop,
        redirectChain,
        cfRay: false,
        serverHeader: null,
      };
    }
  }

  return {
    ok: false,
    httpStatus: null,
    html: "",
    finalUrl: current,
    errorMessage: "Too many redirects",
    redirectCount: MAX_REDIRECTS + 1,
    redirectChain,
    cfRay: false,
    serverHeader: null,
  };
}

function classifyFailure(careersUrl: string, probe: FetchProbe): FailureCategory {
  if (probe.errorMessage) {
    const fromErr = classifyErrorMessage(probe.errorMessage);
    if (fromErr) return fromErr;
    if (probe.errorMessage.toLowerCase().includes("too many redirects")) return "redirect_loop";
  }

  if (probe.redirectCount >= MAX_REDIRECTS) return "redirect_loop";
  if (probe.redirectChain.length > 1) {
    const last = probe.redirectChain[probe.redirectChain.length - 1]!;
    if (probe.redirectChain.filter((u) => u === last).length > 1) return "redirect_loop";
  }

  const status = probe.httpStatus;
  if (status === 429) return "429";
  if (status === 403) return "403";
  if (status === 404 || status === 410) return "404";

  const html = probe.html;
  const finalUrl = probe.finalUrl;

  const cfHeaders = new Headers();
  if (probe.cfRay) cfHeaders.set("cf-ray", "1");
  if (probe.serverHeader?.toLowerCase().includes("cloudflare")) {
    cfHeaders.set("server", "cloudflare");
  }

  if (status !== null && status >= 200 && status < 300) {
    if (html.length === 0) return "empty_html";
    if (isLoginRequired(html, finalUrl)) return "login_required";
    if (isCloudflareHtml(html, cfHeaders)) return "cloudflare_challenge";
    if (isBotProtectionHtml(html)) return "bot_protection";
    if (isMarketingRedirect(careersUrl, finalUrl, html)) return "marketing_page_redirect";
    if (html.length < TINY_HTML_BYTES) return "tiny_html";
  }

  if (status === 403) return "403";
  if (status === 401 || status === 407) return "login_required";

  if (html.length > 0) {
    if (isCloudflareHtml(html, cfHeaders)) return "cloudflare_challenge";
    if (isBotProtectionHtml(html)) return "bot_protection";
    if (isLoginRequired(html, finalUrl)) return "login_required";
    if (isMarketingRedirect(careersUrl, finalUrl, html)) return "marketing_page_redirect";
    if (html.length < TINY_HTML_BYTES) return "tiny_html";
    if (html.length === 0) return "empty_html";
  }

  if (status !== null && status >= 500) return "other";
  return "other";
}

const CATEGORY_HINTS: Record<FailureCategory, RecoveryHints> = {
  dns_failure: { playwright: "NO", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "NO" },
  timeout: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  ssl_failure: { playwright: "NO", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "NO" },
  redirect_loop: { playwright: "NO", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "YES" },
  "403": { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  "404": { playwright: "NO", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "YES" },
  "429": { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  bot_protection: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  cloudflare_challenge: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  marketing_page_redirect: { playwright: "YES", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "YES" },
  login_required: { playwright: "NO", retries: "NO", userAgent: "NO", proxy: "NO", redirectRepair: "NO" },
  empty_html: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "YES", redirectRepair: "NO" },
  tiny_html: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "NO", redirectRepair: "NO" },
  other: { playwright: "YES", retries: "YES", userAgent: "YES", proxy: "NO", redirectRepair: "NO" },
};

/** Share of recovered fetches that yield a company endpoint (from careers ATS audit fetch-ok cohort). */
const ENDPOINT_YIELD_ON_RECOVERED_FETCH = 0.008;

function isRecoverable(cat: FailureCategory): boolean {
  const h = CATEGORY_HINTS[cat];
  return h.playwright === "YES" || h.retries === "YES" || h.userAgent === "YES" || h.proxy === "YES" || h.redirectRepair === "YES";
}

function recoverableByIntervention(cat: FailureCategory, key: keyof RecoveryHints): boolean {
  return CATEGORY_HINTS[cat][key] === "YES";
}

async function auditOne(company: { id: string; careersUrl: string }): Promise<AuditRow> {
  const careersUrl = company.careersUrl;
  const probe = await probeUrl(careersUrl, DEFAULT_UA);

  const fetchOk = probe.ok && probe.html.length >= TINY_HTML_BYTES;
  if (fetchOk) {
    return {
      companyId: company.id,
      careersUrl,
      fetchOk: true,
      category: "success",
      httpStatus: probe.httpStatus,
      finalUrl: probe.finalUrl,
      htmlLength: probe.html.length,
      errorMessage: null,
      redirectCount: probe.redirectCount,
    };
  }

  const category = classifyFailure(careersUrl, probe);
  return {
    companyId: company.id,
    careersUrl,
    fetchOk: false,
    category,
    httpStatus: probe.httpStatus,
    finalUrl: probe.finalUrl,
    htmlLength: probe.html.length,
    errorMessage: probe.errorMessage,
    redirectCount: probe.redirectCount,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const population = await prisma.$queryRaw<[{ c: bigint }]>`
    SELECT COUNT(*)::bigint AS c FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND c."atsType" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
  `;
  const popN = Number(population[0]?.c ?? 0);

  const companies = await prisma.$queryRaw<Array<{ id: string; careersUrl: string }>>`
    SELECT c.id, c."careersUrl" AS "careersUrl"
    FROM "Company" c
    WHERE c."careersUrl" IS NOT NULL
      AND c."atsType" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "AtsEndpoint" e WHERE e."companyId" = c.id)
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE}
  `;

  console.log(`Probing ${companies.length} / ${popN} companies...`);
  const rows = await asyncPool(companies, CONCURRENCY, auditOne);
  const failures = rows.filter((r) => !r.fetchOk);
  const successes = rows.filter((r) => r.fetchOk);
  const scale = popN / rows.length;

  const byCat = new Map<FailureCategory, AuditRow[]>();
  for (const r of failures) {
    const cat = r.category as FailureCategory;
    const list = byCat.get(cat) ?? [];
    list.push(r);
    byCat.set(cat, list);
  }

  const outPath = "/home/ubuntu/jobSeek/docs/audit/careers-fetch-failure-audit-1000.json";
  const report = {
    sampledAt: new Date().toISOString(),
    popN,
    sample: rows.length,
    fetchOk: successes.length,
    fetchFailed: failures.length,
    tinyHtmlThreshold: TINY_HTML_BYTES,
    timeoutMs: TIMEOUT_MS,
    userAgent: DEFAULT_UA,
    categories: [...byCat.entries()].map(([category, items]) => ({
      category,
      count: items.length,
      pctOfFailures: pct(items.length, failures.length),
      pctOfSample: pct(items.length, rows.length),
      estPopulation: Math.round(items.length * scale),
      examples: items.slice(0, 5).map((r) => ({
        careersUrl: r.careersUrl,
        httpStatus: r.httpStatus,
        finalUrl: r.finalUrl,
        htmlLength: r.htmlLength,
        errorMessage: r.errorMessage,
      })),
      recovery: CATEGORY_HINTS[category],
      recoverable: isRecoverable(category),
    })),
    rows,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const sortedCats = [...byCat.entries()].sort((a, b) => {
    const recoverA = isRecoverable(a[0]) ? a[1].length : 0;
    const recoverB = isRecoverable(b[0]) ? b[1].length : 0;
    return recoverB - recoverA || b[1].length - a[1].length;
  });

  const [currentEndpoints, totalCompanies] = await Promise.all([
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(DISTINCT "companyId")::bigint AS c FROM "AtsEndpoint" WHERE "companyId" IS NOT NULL
    `,
    prisma.company.count(),
  ]);
  const endpointsNow = Number(currentEndpoints[0]?.c ?? 0);

  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        population: popN,
        sample: rows.length,
        fetchOk: successes.length,
        fetchFailed: failures.length,
        fetchFailPct: pct(failures.length, rows.length),
        estFetchFailedPop: Math.round(failures.length * scale),
      },
      null,
      2,
    ),
  );

  console.log("\n=== FAILURE CATEGORIES ===");
  for (const [cat, items] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const hints = CATEGORY_HINTS[cat];
    console.log(`\n## ${cat} — ${items.length} (${pct(items.length, failures.length)} of failures, est pop ${Math.round(items.length * scale)})`);
    console.log(
      `Playwright=${hints.playwright} Retries=${hints.retries} UA=${hints.userAgent} Proxy=${hints.proxy} RedirectRepair=${hints.redirectRepair}`,
    );
    for (const ex of items.slice(0, 3)) {
      console.log(`  - ${ex.careersUrl} status=${ex.httpStatus} len=${ex.htmlLength} final=${ex.finalUrl ?? "n/a"}`);
    }
  }

  console.log("\n=== RANKED BY RECOVERABLE COUNT (sample) ===");
  for (const [cat, items] of sortedCats) {
    const rec = isRecoverable(cat) ? items.length : 0;
    console.log(`${cat.padEnd(28)} total=${String(items.length).padStart(4)} recoverable=${String(rec).padStart(4)} est_pop=${Math.round(items.length * scale)}`);
  }

  const interventions: Array<{
    name: string;
    key: keyof RecoveryHints;
    recoveryRate: number;
  }> = [
    { name: "User-agent rotation", key: "userAgent", recoveryRate: 0.55 },
    { name: "Playwright fallback", key: "playwright", recoveryRate: 0.65 },
    { name: "Retry strategy (429/timeout)", key: "retries", recoveryRate: 0.7 },
    { name: "Redirect repair", key: "redirectRepair", recoveryRate: 0.45 },
    { name: "Proxy rotation", key: "proxy", recoveryRate: 0.5 },
  ];

  console.log("\n=== COVERAGE ESTIMATES (intervention → recovered fetch → endpoints) ===");
  for (const iv of interventions) {
    const eligible = failures.filter((r) => recoverableByIntervention(r.category as FailureCategory, iv.key));
    const estRecoveredFetch = Math.round(eligible.length * scale * iv.recoveryRate);
    const estNewEndpoints = Math.round(estRecoveredFetch * ENDPOINT_YIELD_ON_RECOVERED_FETCH);
    const after = endpointsNow + estNewEndpoints;
    console.log(
      JSON.stringify({
        intervention: iv.name,
        eligibleFailuresSample: eligible.length,
        estRecoveredFetchesPop: estRecoveredFetch,
        estNewEndpointsPop: estNewEndpoints,
        estEndpointsAfter: after,
        estCoveragePct: pct(after, totalCompanies),
      }),
    );
  }

  const allRecoverable = failures.filter((r) => isRecoverable(r.category as FailureCategory));
  const unionEst = Math.round(allRecoverable.length * scale * 0.5);
  const unionEndpoints = Math.round(unionEst * ENDPOINT_YIELD_ON_RECOVERED_FETCH);
  console.log(
    "\n=== UNION (any intervention, 50% overlap-adjusted) ===",
    JSON.stringify({
      recoverableFailuresSample: allRecoverable.length,
      estRecoveredFetchesPop: unionEst,
      estNewEndpointsPop: unionEndpoints,
      estEndpointsAfter: endpointsNow + unionEndpoints,
      estCoveragePct: pct(endpointsNow + unionEndpoints, totalCompanies),
    }),
  );

  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
